/**
 * 국토교통부(TAGO) 버스노선정보 / 버스위치정보 서비스
 *  - https://apis.data.go.kr/1613000/BusRouteInfoInqireService
 *  - https://apis.data.go.kr/1613000/BusLcInfoInqireService
 */
import { cached, TTL, type Cache } from "../cache.js";
import type { DataGoKrClient } from "../datagokr/client.js";

const ROUTE_SERVICE = "/1613000/BusRouteInfoInqireService";
const LOCATION_SERVICE = "/1613000/BusLcInfoInqireService";

export interface Route {
  routeId: string;
  routeNo: string;
  routeType?: string;
  /** 기점 */
  startStop?: string;
  /** 종점 */
  endStop?: string;
  /** 첫차 시각 HH:MM */
  firstBus?: string;
  /** 막차 시각 HH:MM */
  lastBus?: string;
}

export interface RouteDetail extends Route {
  /** 배차간격(분): 평일 / 토요일 / 일요일·공휴일 */
  intervalMin?: { weekday?: number; saturday?: number; sunday?: number };
}

export interface RouteStop {
  /** 노선 내 순번 (1부터) */
  order: number;
  nodeId: string;
  name: string;
  stopNo?: string;
  /** 0 또는 1. 같은 값끼리 같은 방향 (0: 기점→종점, 1: 종점→기점) */
  direction?: 0 | 1;
  lat: number;
  lng: number;
}

export interface BusLocation {
  vehicleNo: string;
  /** 현재(또는 직전) 정류소. API가 비워 보내는 경우가 있다 (2026-11-17 실제 확인) */
  stopName?: string;
  nodeId?: string;
  /** 노선 내 정류소 순번 — get_route_stops 의 order 와 같다. 위치를 모르는 차량은 없음 */
  stopOrder?: number;
  lat: number;
  lng: number;
}

export interface DirectionAtStop {
  /** 이 정류소 다음 정류소 이름 ("○○ 방면" 안내용) */
  nextStop?: string;
  /** 향하는 종점(방향) */
  towards?: string;
}

interface RawRoute {
  routeid: string;
  routeno: number | string;
  routetp?: string;
  startnodenm?: string;
  endnodenm?: string;
  startvehicletime?: number | string;
  endvehicletime?: number | string;
  intervaltime?: number | string;
  intervalsattime?: number | string;
  intervalsuntime?: number | string;
}

interface RawRouteStop {
  nodeid: string;
  nodenm: string;
  nodeno?: number | string;
  nodeord: number | string;
  updowncd?: number | string;
  gpslati: number | string;
  gpslong: number | string;
}

interface RawBusLocation {
  vehicleno: string;
  nodeid?: string;
  nodenm?: string;
  nodeord?: number | string;
  gpslati: number | string;
  gpslong: number | string;
}

export class TagoRoutes {
  constructor(
    private readonly client: DataGoKrClient,
    private readonly cache: Cache,
  ) {}

  /** 노선 번호로 노선 검색 (예: "106" → 106번 노선의 routeId) */
  searchRoutes(cityCode: number, routeNo: string): Promise<Route[]> {
    return cached(this.cache, `tago:routes:${cityCode}:${routeNo}`, TTL.routes, async () => {
      const { items } = await this.client.getList<RawRoute>(`${ROUTE_SERVICE}/getRouteNoList`, {
        cityCode,
        routeNo,
        numOfRows: 100,
        pageNo: 1,
      });
      return items.map(toRoute);
    });
  }

  /** 노선 상세 (기점·종점, 첫차·막차, 배차간격) */
  getRouteInfo(cityCode: number, routeId: string): Promise<RouteDetail | undefined> {
    return cached(this.cache, `tago:routeInfo:${cityCode}:${routeId}`, TTL.routes, async () => {
      // 이 오퍼레이션은 totalCount 를 0으로 주면서 item 은 내려준다 → items 만 본다
      const { items } = await this.client.getList<RawRoute>(`${ROUTE_SERVICE}/getRouteInfoIem`, { cityCode, routeId });
      const raw = items[0];
      if (!raw) return undefined;
      return {
        ...toRoute(raw),
        intervalMin: {
          weekday: toNum(raw.intervaltime),
          saturday: toNum(raw.intervalsattime),
          sunday: toNum(raw.intervalsuntime),
        },
      };
    });
  }

  /** 노선이 경유하는 정류소 목록 (순번 순) */
  getRouteStops(cityCode: number, routeId: string): Promise<RouteStop[]> {
    return cached(this.cache, `tago:routeStops:${cityCode}:${routeId}`, TTL.routes, async () => {
      const { items } = await this.client.getList<RawRouteStop>(`${ROUTE_SERVICE}/getRouteAcctoThrghSttnList`, {
        cityCode,
        routeId,
        numOfRows: 500,
        pageNo: 1,
      });
      return items.map(toRouteStop).sort((a, b) => a.order - b.order);
    });
  }

  /** 노선의 실시간 버스 위치 */
  getBusLocations(cityCode: number, routeId: string): Promise<BusLocation[]> {
    return cached(this.cache, `tago:busLoc:${cityCode}:${routeId}`, TTL.busLocations, async () => {
      const { items } = await this.client.getList<RawBusLocation>(`${LOCATION_SERVICE}/getRouteAcctoBusLcList`, {
        cityCode,
        routeId,
        numOfRows: 200,
        pageNo: 1,
      });
      return items
        .map((b) => ({
          vehicleNo: String(b.vehicleno),
          stopName: b.nodenm ? String(b.nodenm) : undefined,
          nodeId: b.nodeid ? String(b.nodeid) : undefined,
          stopOrder: toNum(b.nodeord),
          lat: Number(b.gpslati),
          lng: Number(b.gpslong),
        }))
        // 위치를 모르는 차량은 맨 뒤로
        .sort((a, b) => (a.stopOrder ?? Infinity) - (b.stopOrder ?? Infinity));
    });
  }

  /**
   * 노선 기준으로 이 정류소에서 버스가 어느 쪽으로 가는지.
   * "정류소 경유 노선" API에는 방향이 없어서, 노선의 경유 정류소 목록에서 이 정류소의 다음 정류소와 방향 코드를 찾는다.
   */
  async directionAtStop(cityCode: number, route: Route, nodeId: string): Promise<DirectionAtStop> {
    const stops = await this.getRouteStops(cityCode, route.routeId);
    const idx = stops.findIndex((s) => s.nodeId === nodeId);
    if (idx < 0) return {};
    const here = stops[idx];
    const next = stops[idx + 1];
    const towards = here.direction === 0 ? route.endStop : here.direction === 1 ? route.startStop : undefined;
    return { nextStop: next?.name, towards };
  }
}

export function toRoute(r: RawRoute): Route {
  return {
    routeId: String(r.routeid),
    routeNo: String(r.routeno),
    routeType: r.routetp || undefined,
    startStop: r.startnodenm || undefined,
    endStop: r.endnodenm || undefined,
    firstBus: toHHMM(r.startvehicletime),
    lastBus: toHHMM(r.endvehicletime),
  };
}

function toRouteStop(s: RawRouteStop): RouteStop {
  const dir = s.updowncd != null && s.updowncd !== "" ? Number(s.updowncd) : undefined;
  return {
    order: Number(s.nodeord),
    nodeId: String(s.nodeid),
    name: String(s.nodenm),
    stopNo: s.nodeno != null && s.nodeno !== "" ? String(s.nodeno) : undefined,
    direction: dir === 0 || dir === 1 ? dir : undefined,
    lat: Number(s.gpslati),
    lng: Number(s.gpslong),
  };
}

/** API가 "0545"(문자열) 또는 2230(숫자)으로 주는 시각을 "05:45" 형태로 */
export function toHHMM(v: number | string | undefined): string | undefined {
  if (v == null || v === "") return undefined;
  const s = String(v).padStart(4, "0");
  if (!/^\d{4}$/.test(s)) return undefined;
  return `${s.slice(0, 2)}:${s.slice(2)}`;
}

function toNum(v: number | string | undefined): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
