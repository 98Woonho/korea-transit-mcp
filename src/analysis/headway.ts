/**
 * 노선 운행 간격 분석 (순수 함수, API 호출 없음).
 *
 * 공공 API에는 버스별 운행 시각이 없어서, 정류장 수로 간격을 잰다.
 * 기준: 운행 중인 버스 K대가 노선(정류장 N개)에 고르게 퍼져 있으면 앞뒤 차 간격은 N/K 정류장이고,
 *       그때의 시간 간격은 대략 계획 배차간격과 같다. 따라서
 *         ratio  = 실제 간격(정류장) / (N/K)
 *         estMin = ratio × 오늘 적용 배차간격(분)   ← 추정치
 * 몰림·공백 "판단"은 하지 않는다. 기준은 이 결과를 해석하는 쪽(Skill)이 정한다.
 */
import type { BusLocation, RouteDetail, RouteStop } from "../tago/routes.js";
import { turnaroundOrder } from "./direct.js";

export type DayType = "weekday" | "saturday" | "sunday";

export interface HeadwayGap {
  /** 뒤차 (순번이 작은 쪽) */
  behind: string;
  /** 앞차 (순번이 큰 쪽) */
  ahead: string;
  fromOrder: number;
  toOrder: number;
  /** 두 버스 사이 정류장 수 */
  gapStops: number;
  /** 균등 배치 간격 대비 비율 (1 = 균등) */
  ratio: number;
  /** 추정 시간 간격(분). 배차간격 정보가 없으면 생략 */
  estMin?: number;
  /** 이 간격 안에 종점 회차 지점이 있음 (회차 대기 시간 때문에 실제 시간 간격이 더 길 수 있음) */
  crossesTurnaround: boolean;
}

export interface HeadwayAnalysis {
  routeId: string;
  routeNo?: string;
  totalStops: number;
  busCount: number;
  /** 오늘 요일 유형(KST). 공휴일은 반영하지 않음 */
  dayType: DayType;
  /** 오늘 적용되는 계획 배차간격(분) */
  scheduledIntervalMin?: number;
  /** 균등 배치 시 앞뒤 차 간격(정류장) */
  idealGapStops?: number;
  /** 노선 순번 순으로 정렬한 버스 위치 */
  buses: { vehicleNo: string; stopOrder: number; stopName: string; direction?: 0 | 1 }[];
  /** 앞뒤 차 사이 간격 (노선 순번 순) */
  gaps: HeadwayGap[];
  notes: string[];
}

export function dayTypeKst(now: Date): DayType {
  const day = new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCDay();
  return day === 0 ? "sunday" : day === 6 ? "saturday" : "weekday";
}

export function analyzeHeadway(input: {
  routeId: string;
  route?: RouteDetail;
  stops: RouteStop[];
  buses: BusLocation[];
  now: Date;
}): HeadwayAnalysis {
  const { route, stops, now } = input;
  const totalStops = stops.length;
  const dirByOrder = new Map(stops.map((s) => [s.order, s.direction]));
  const buses = [...input.buses]
    .sort((a, b) => a.stopOrder - b.stopOrder)
    .map((b) => ({ vehicleNo: b.vehicleNo, stopOrder: b.stopOrder, stopName: b.stopName, direction: dirByOrder.get(b.stopOrder) }));

  const dayType = dayTypeKst(now);
  const interval = route?.intervalMin?.[dayType];
  const scheduledIntervalMin = interval && interval > 0 ? interval : undefined;
  const notes: string[] = [
    "간격은 정류장 수 기준이며, estMin은 '균등 배치 = 계획 배차간격' 가정에 따른 추정치입니다.",
    "기점(차고지)에서 출발 대기 중인 차량은 위치 정보에 나오지 않습니다.",
  ];
  if (dayType !== "weekday") notes.push("공휴일 여부는 반영하지 않았습니다.");

  if (buses.length < 2 || totalStops === 0) {
    notes.push(buses.length === 0 ? "현재 운행 중인 버스가 없습니다." : "운행 중인 버스가 1대뿐이라 간격을 계산할 수 없습니다.");
    return { routeId: input.routeId, routeNo: route?.routeNo, totalStops, busCount: buses.length, dayType, scheduledIntervalMin, buses, gaps: [], notes };
  }

  const idealGapStops = totalStops / buses.length;
  const turn = turnaroundOrder(stops);
  const gaps: HeadwayGap[] = [];
  for (let i = 1; i < buses.length; i++) {
    const behind = buses[i - 1];
    const ahead = buses[i];
    const gapStops = ahead.stopOrder - behind.stopOrder;
    const ratio = round2(gapStops / idealGapStops);
    gaps.push({
      behind: behind.vehicleNo,
      ahead: ahead.vehicleNo,
      fromOrder: behind.stopOrder,
      toOrder: ahead.stopOrder,
      gapStops,
      ratio,
      estMin: scheduledIntervalMin ? Math.round(ratio * scheduledIntervalMin) : undefined,
      crossesTurnaround: turn !== undefined && behind.stopOrder < turn && ahead.stopOrder >= turn,
    });
  }

  return {
    routeId: input.routeId,
    routeNo: route?.routeNo,
    totalStops,
    busCount: buses.length,
    dayType,
    scheduledIntervalMin,
    idealGapStops: round2(idealGapStops),
    buses,
    gaps,
    notes,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
