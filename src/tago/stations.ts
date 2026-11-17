/**
 * 국토교통부(TAGO) 버스정류소정보 서비스
 * 엔드포인트: https://apis.data.go.kr/1613000/BusSttnInfoInqireService
 */
import { cached, TTL, type Cache } from "../cache.js";
import type { DataGoKrClient } from "../datagokr/client.js";
import { toRoute, type Route } from "./routes.js";

const SERVICE = "/1613000/BusSttnInfoInqireService";

export interface City {
  cityCode: number;
  cityName: string;
}

export interface BusStop {
  nodeId: string;
  name: string;
  /** 정류소 번호(정류장 표지판에 적힌 번호). 지역에 따라 없을 수 있음 */
  stopNo?: string;
  lat: number;
  lng: number;
  cityCode?: number;
}

interface RawCity {
  citycode: number | string;
  cityname: string;
}

interface RawStop {
  nodeid: string;
  nodenm: string;
  nodeno?: number | string;
  gpslati: number | string;
  gpslong: number | string;
  citycode?: number | string;
}

export interface SearchStopsInput {
  cityCode: number;
  name?: string;
  stopNo?: string;
  limit?: number;
}

export class TagoStations {
  constructor(
    private readonly client: DataGoKrClient,
    private readonly cache: Cache,
  ) {}

  /** TAGO가 지원하는 도시 코드 목록 */
  listCities(): Promise<City[]> {
    return cached(this.cache, "tago:cities", TTL.cityCodes, async () => {
      const { items } = await this.client.getList<RawCity>(`${SERVICE}/getCtyCodeList`);
      return items.map((c) => ({ cityCode: Number(c.citycode), cityName: String(c.cityname) }));
    });
  }

  /**
   * 도시 코드 + 정류소명/번호로 정류소 검색.
   * API는 정류소 ID 순으로 주기 때문에 그대로 자르면 정확히 일치하는 정류소가 잘려 나갈 수 있다.
   * 그래서 후보를 넉넉히(최대 CANDIDATES건) 받아 관련도 순으로 정렬한 뒤 limit만큼 돌려준다.
   * 캐시는 limit과 무관하게 정렬된 후보 전체를 저장한다.
   */
  async searchStops(input: SearchStopsInput): Promise<BusStop[]> {
    const limit = input.limit ?? 20;
    const key = `tago:stops:${input.cityCode}:${input.name ?? ""}:${input.stopNo ?? ""}`;
    const ranked = await cached(this.cache, key, TTL.stops, async () => {
      const { items } = await this.client.getList<RawStop>(`${SERVICE}/getSttnNoList`, {
        cityCode: input.cityCode,
        nodeNm: input.name,
        nodeNo: input.stopNo,
        numOfRows: CANDIDATES,
        pageNo: 1,
      });
      const stops = items.map(toBusStop);
      return input.name ? rankByName(stops, input.name) : stops;
    });
    return ranked.slice(0, limit);
  }

  /**
   * 좌표 주변 정류소 (가까운 순). 도시 코드 없이 전국에서 찾고, 결과에 cityCode 가 들어 있다.
   * 같은 정류소가 인접 도시 시스템(예: 대전·세종)에 중복 등록되어 함께 나올 수 있다.
   */
  async findNearby(lat: number, lng: number, limit = 10): Promise<(BusStop & { distanceM: number })[]> {
    // 좌표를 소수 4자리(약 10m)로 반올림해 캐시 적중률을 높인다
    const rLat = Number(lat.toFixed(4));
    const rLng = Number(lng.toFixed(4));
    const all = await cached(this.cache, `tago:nearby:${rLat}:${rLng}`, TTL.stops, async () => {
      const { items } = await this.client.getList<RawStop>(`${SERVICE}/getCrdntPrxmtSttnList`, {
        gpsLati: rLat,
        gpsLong: rLng,
        numOfRows: CANDIDATES,
        pageNo: 1,
      });
      return items.map(toBusStop);
    });
    return all
      .map((s) => ({ ...s, distanceM: Math.round(distanceMeters(lat, lng, s.lat, s.lng)) }))
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, limit);
  }

  /** 정류소를 경유하는 노선 목록 (방향 정보는 없음 → TagoRoutes.directionAtStop 으로 보강) */
  getRoutesAtStop(cityCode: number, nodeId: string): Promise<Route[]> {
    return cached(this.cache, `tago:stopRoutes:${cityCode}:${nodeId}`, TTL.routes, async () => {
      // 주의: 이 오퍼레이션만 파라미터 이름이 소문자 nodeid 다
      const { items } = await this.client.getList<Parameters<typeof toRoute>[0]>(`${SERVICE}/getSttnThrghRouteList`, {
        cityCode,
        nodeid: nodeId,
        numOfRows: CANDIDATES,
        pageNo: 1,
      });
      return items.map(toRoute);
    });
  }
}

/** 두 좌표 사이 거리(m), 하버사인 공식 */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const CANDIDATES = 100;

/**
 * 검색어와의 관련도 순 정렬: 완전 일치 → 앞부분 일치 → 포함 순이고, 같은 등급이면 이름이 짧을수록(검색어에 가까울수록) 앞.
 * 공백과 구분 기호(. , ·)는 무시하고 비교한다. 정렬은 안정적이라 같은 점수면 API 원래 순서를 유지한다.
 */
export function rankByName<T extends { name: string }>(stops: T[], query: string): T[] {
  const norm = (s: string) => s.replace(/[\s.,·]/g, "");
  const q = norm(query);
  const tier = (name: string) => {
    const n = norm(name);
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    if (n.includes(q)) return 2;
    return 3;
  };
  return stops
    .map((stop) => ({ stop, tier: tier(stop.name), len: norm(stop.name).length }))
    .sort((a, b) => a.tier - b.tier || a.len - b.len)
    .map((x) => x.stop);
}

function toBusStop(s: RawStop): BusStop {
  return {
    nodeId: String(s.nodeid),
    name: String(s.nodenm),
    stopNo: s.nodeno != null && s.nodeno !== "" ? String(s.nodeno) : undefined,
    lat: Number(s.gpslati),
    lng: Number(s.gpslong),
    cityCode: s.citycode != null ? Number(s.citycode) : undefined,
  };
}
