/**
 * 직통 노선 판별 (순수 함수, API 호출 없음).
 * 노선의 경유 정류소 순서에서 출발 정류소가 도착 정류소보다 앞에 있으면 갈아타지 않고 갈 수 있다.
 */
import type { Route, RouteStop } from "../tago/routes.js";

export interface DirectRoute {
  routeId: string;
  routeNo: string;
  routeType?: string;
  /** 실제로 타야 하는 출발 정류소 (이름이 같은 후보 중 하나) */
  fromNodeId: string;
  fromStopName: string;
  /** 내리는 정류소 */
  toNodeId: string;
  toStopName: string;
  /** 이동하는 정류장 수 */
  stopCount: number;
  /** 출발 정류소에서 버스가 향하는 종점 */
  towards?: string;
  /** 출발 정류소 다음 정류소 ("○○ 방면" 안내용) */
  nextStop?: string;
  /** 종점(회차 지점)을 지나서 가는 경로인지 — 회차지에서 하차해야 하는 노선도 있어 안내가 필요 */
  viaTurnaround: boolean;
}

/**
 * 한 노선에서 출발 후보 → 도착 후보 중 갈 수 있는 가장 짧은 조합을 찾는다.
 * @param stops 노선 경유 정류소 (order 오름차순)
 */
export function findDirect(
  route: Route,
  stops: RouteStop[],
  fromNodeIds: string[],
  toNodeIds: string[],
): DirectRoute | undefined {
  const turnaround = turnaroundOrder(stops);
  let best: DirectRoute | undefined;

  stops.forEach((from, i) => {
    if (!fromNodeIds.includes(from.nodeId)) return;
    for (let j = i + 1; j < stops.length; j++) {
      const to = stops[j];
      if (!toNodeIds.includes(to.nodeId)) continue;
      const stopCount = to.order - from.order;
      if (!best || stopCount < best.stopCount) best = legBetween(route, stops, i, j, turnaround);
      break; // 이 출발 정류소에서는 가장 가까운 도착 후보만 보면 된다
    }
  });
  return best;
}

/** 노선의 i번째 정류소에서 타서 j번째(i < j) 정류소에서 내리는 구간 */
export function legBetween(
  route: Route,
  stops: RouteStop[],
  i: number,
  j: number,
  turnaround = turnaroundOrder(stops),
): DirectRoute {
  const from = stops[i];
  const to = stops[j];
  return {
    routeId: route.routeId,
    routeNo: route.routeNo,
    routeType: route.routeType,
    fromNodeId: from.nodeId,
    fromStopName: from.name,
    toNodeId: to.nodeId,
    toStopName: to.name,
    stopCount: to.order - from.order,
    towards: from.direction === 0 ? route.endStop : from.direction === 1 ? route.startStop : undefined,
    nextStop: stops[i + 1]?.name,
    viaTurnaround: turnaround !== undefined && from.order < turnaround && to.order >= turnaround,
  };
}

/** 방향 코드가 0 → 1로 바뀌는 첫 정류소의 순번 (= 종점에서 회차한 뒤 첫 정류소). 없으면 undefined */
export function turnaroundOrder(stops: RouteStop[]): number | undefined {
  for (let i = 1; i < stops.length; i++) {
    if (stops[i - 1].direction === 0 && stops[i].direction === 1) return stops[i].order;
  }
  return undefined;
}
