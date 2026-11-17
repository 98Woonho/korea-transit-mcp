/**
 * 국토교통부(TAGO) 버스도착정보 서비스
 * 엔드포인트: https://apis.data.go.kr/1613000/ArvlInfoInqireService
 */
import { cached, TTL, type Cache } from "../cache.js";
import type { DataGoKrClient } from "../datagokr/client.js";

const SERVICE = "/1613000/ArvlInfoInqireService";

export interface BusArrival {
  routeId: string;
  routeNo: string;
  /** 노선 유형. 예: 간선버스, 지선버스 */
  routeType?: string;
  /** 차량 유형. 예: 저상버스, 일반차량 */
  vehicleType?: string;
  /** 도착까지 남은 시간(초) */
  arrivalSec: number;
  /** 도착까지 남은 시간(분, 올림) — LLM이 그대로 읽기 좋게 */
  arrivalMin: number;
  /** 몇 정류장 전인지 */
  stopsAway: number;
}

interface RawArrival {
  arrprevstationcnt: number | string;
  arrtime: number | string;
  nodeid: string;
  nodenm: string;
  routeid: string;
  routeno: number | string;
  routetp?: string;
  vehicletp?: string;
}

export interface GetArrivalsInput {
  cityCode: number;
  nodeId: string;
  /** 특정 노선만 조회 */
  routeId?: string;
}

export class TagoArrivals {
  constructor(
    private readonly client: DataGoKrClient,
    private readonly cache: Cache,
  ) {}

  /** 정류소의 도착 예정 버스 목록 (도착이 빠른 순) */
  getArrivals(input: GetArrivalsInput): Promise<BusArrival[]> {
    const key = `tago:arrivals:${input.cityCode}:${input.nodeId}:${input.routeId ?? ""}`;
    return cached(this.cache, key, TTL.arrivals, async () => {
      const op = input.routeId
        ? "getSttnAcctoSpcifyRouteBusArvlPrearngeInfoList"
        : "getSttnAcctoArvlPrearngeInfoList";
      const { items } = await this.client.getList<RawArrival>(`${SERVICE}/${op}`, {
        cityCode: input.cityCode,
        nodeId: input.nodeId,
        routeId: input.routeId,
        numOfRows: 100,
        pageNo: 1,
      });
      return items.map(toArrival).sort((a, b) => a.arrivalSec - b.arrivalSec);
    });
  }
}

function toArrival(a: RawArrival): BusArrival {
  const arrivalSec = Number(a.arrtime);
  return {
    routeId: String(a.routeid),
    routeNo: String(a.routeno),
    routeType: a.routetp || undefined,
    vehicleType: a.vehicletp || undefined,
    arrivalSec,
    arrivalMin: Math.ceil(arrivalSec / 60),
    stopsAway: Number(a.arrprevstationcnt),
  };
}
