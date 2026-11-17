/**
 * 1회 환승 경로 탐색 (순수 함수, API 호출 없음).
 *
 * 첫 노선(출발 정류소를 지나는 노선)을 타고 갈 수 있는 정류소들과, 둘째 노선(도착 정류소를 지나는 노선)을 타면
 * 목적지까지 갈 수 있는 정류소들을 "같은 정류소" 또는 "걸어서 갈 수 있는 거리(maxWalkM)"로 잇는다.
 * 두 구간 모두 노선의 경유 순서(방향 포함)로 확인하므로, 반대 방향 정류소에서 갈아타는 경로는 나오지 않는다.
 */
import type { Route, RouteStop } from "../tago/routes.js";
import { distanceMeters } from "../tago/stations.js";
import { legBetween, turnaroundOrder, type DirectRoute } from "./direct.js";

export interface RouteWithStops {
  route: Route;
  /** 노선 경유 정류소 (order 오름차순) */
  stops: RouteStop[];
}

export interface TransferLeg extends DirectRoute {
  fromStopNo?: string;
  toStopNo?: string;
}

export interface TransferRoute {
  /** 두 구간의 이동 정류장 수 합 */
  totalStops: number;
  /** 갈아타는 두 정류소 사이 직선거리(m). 같은 정류소면 0 */
  walkM: number;
  /** 내린 정류소에서 그대로 갈아타는지 */
  sameStop: boolean;
  legs: [TransferLeg, TransferLeg];
}

export interface FindTransfersOptions {
  /** 갈아탈 때 걸어서 이동해도 되는 최대 직선거리(m). 0이면 같은 정류소 환승만 */
  maxWalkM: number;
  limit: number;
}

/** 한 노선 안에서 정류소 하나에 대한 최선의 위치 (환승 지점 후보) */
interface Point {
  /** 노선 내 탑승 인덱스 */
  i: number;
  /** 노선 내 하차 인덱스 */
  j: number;
  stopCount: number;
  stop: RouteStop;
}

/**
 * @param firstRoutes 출발 정류소를 지나는 노선들
 * @param secondRoutes 도착 정류소를 지나는 노선들
 */
export function findTransfers(
  firstRoutes: RouteWithStops[],
  secondRoutes: RouteWithStops[],
  fromNodeIds: string[],
  toNodeIds: string[],
  { maxWalkM, limit }: FindTransfersOptions,
): TransferRoute[] {
  const from = new Set(fromNodeIds);
  const to = new Set(toNodeIds);
  const results: TransferRoute[] = [];

  // 첫 노선마다: 출발 정류소에서 타고 갈 수 있는 정류소 → 가장 적게 가는 위치
  const reach = firstRoutes.map(({ stops }) => {
    const m = new Map<string, Point>();
    stops.forEach((s, i) => {
      if (!from.has(s.nodeId)) return;
      for (let j = i + 1; j < stops.length; j++) {
        const t = stops[j];
        if (from.has(t.nodeId)) break; // 출발 정류소로 되돌아오면 거기서 다시 타는 것과 같다
        const stopCount = t.order - s.order;
        const prev = m.get(t.nodeId);
        if (!prev || stopCount < prev.stopCount) m.set(t.nodeId, { i, j, stopCount, stop: t });
      }
    });
    return m;
  });

  // 둘째 노선마다: 여기서 타면 도착 정류소까지 갈 수 있는 정류소 → 가장 적게 가는 위치
  const feed = secondRoutes.map(({ stops }) => {
    const m = new Map<string, Point>();
    stops.forEach((t, j) => {
      if (!to.has(t.nodeId)) return;
      for (let i = j - 1; i >= 0; i--) {
        const s = stops[i];
        if (to.has(s.nodeId)) break;
        const stopCount = t.order - s.order;
        const prev = m.get(s.nodeId);
        if (!prev || stopCount < prev.stopCount) m.set(s.nodeId, { i, j, stopCount, stop: s });
      }
    });
    return m;
  });

  // 갈아타지 않고 갈 수 있는 노선은 환승 경로에서 뺀다 (그 노선을 계속 타면 된다)
  const isDirectA = reach.map((m) => [...m.keys()].some((id) => to.has(id)));
  const isDirectB = feed.map((m) => [...m.keys()].some((id) => from.has(id)));

  firstRoutes.forEach((a, ai) => {
    secondRoutes.forEach((b, bi) => {
      if (a.route.routeId === b.route.routeId || isDirectA[ai] || isDirectB[bi]) return;
      const best = bestJoin([...reach[ai].values()], feed[bi], maxWalkM);
      if (!best) return;
      const [x, y, walkM] = best;
      results.push({
        totalStops: x.stopCount + y.stopCount,
        walkM: Math.round(walkM),
        sameStop: x.stop.nodeId === y.stop.nodeId,
        legs: [withStopNo(a, x), withStopNo(b, y)],
      });
    });
  });

  return results.sort((p, q) => p.totalStops - q.totalStops || p.walkM - q.walkM).slice(0, limit);
}

/** 첫 노선의 하차 후보 × 둘째 노선의 탑승 후보 중 (정류장 수 합, 걷는 거리)가 가장 작은 조합 */
function bestJoin(xs: Point[], feed: Map<string, Point>, maxWalkM: number): [Point, Point, number] | undefined {
  let best: [Point, Point, number] | undefined;
  const consider = (x: Point, y: Point, walk: number) => {
    if (!best) return void (best = [x, y, walk]);
    const total = x.stopCount + y.stopCount;
    const bestTotal = best[0].stopCount + best[1].stopCount;
    if (total < bestTotal || (total === bestTotal && walk < best[2])) best = [x, y, walk];
  };

  const ys = [...feed.values()];
  // 걸어서 갈아타기: 위도 차이로 먼저 거르고 실제 거리를 잰다 (위도 1도 ≈ 111km)
  const latWindow = maxWalkM / 111_000;
  for (const x of xs) {
    const same = feed.get(x.stop.nodeId);
    if (same) consider(x, same, 0);
    if (maxWalkM <= 0) continue;
    for (const y of ys) {
      if (y.stop.nodeId === x.stop.nodeId || Math.abs(y.stop.lat - x.stop.lat) > latWindow) continue;
      const d = distanceMeters(x.stop.lat, x.stop.lng, y.stop.lat, y.stop.lng);
      if (d <= maxWalkM) consider(x, y, d);
    }
  }
  return best;
}

function withStopNo({ route, stops }: RouteWithStops, p: Point): TransferLeg {
  return {
    ...legBetween(route, stops, p.i, p.j, turnaroundOrder(stops)),
    fromStopNo: stops[p.i].stopNo,
    toStopNo: stops[p.j].stopNo,
  };
}
