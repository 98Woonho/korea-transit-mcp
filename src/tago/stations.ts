/**
 * 국토교통부(TAGO) 버스정류소정보 서비스
 * 엔드포인트: https://apis.data.go.kr/1613000/BusSttnInfoInqireService
 */
import { cached, TTL, type Cache } from "../cache.js";
import type { DataGoKrClient } from "../datagokr/client.js";

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

  /** 도시 코드 + 정류소명/번호로 정류소 검색 */
  searchStops(input: SearchStopsInput): Promise<BusStop[]> {
    const limit = input.limit ?? 20;
    const key = `tago:stops:${input.cityCode}:${input.name ?? ""}:${input.stopNo ?? ""}:${limit}`;
    return cached(this.cache, key, TTL.stops, async () => {
      const { items } = await this.client.getList<RawStop>(`${SERVICE}/getSttnNoList`, {
        cityCode: input.cityCode,
        nodeNm: input.name,
        nodeNo: input.stopNo,
        numOfRows: limit,
        pageNo: 1,
      });
      return items.map(toBusStop);
    });
  }
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
