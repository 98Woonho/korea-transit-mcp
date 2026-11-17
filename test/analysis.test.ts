import { describe, expect, it } from "vitest";
import { findDirect, turnaroundOrder } from "../src/analysis/direct.js";
import { analyzeHeadway, dayTypeKst } from "../src/analysis/headway.js";
import { findTransfers } from "../src/analysis/transfer.js";
import type { BusLocation, Route, RouteStop } from "../src/tago/routes.js";
import { connectWith, okResponse, parse } from "./helpers.js";

/** 1..n 순번의 순환 노선. half 이하는 방향 0(기점→종점), 나머지는 방향 1 */
function loopStops(n: number, half: number, names: Record<number, [string, string]> = {}): RouteStop[] {
  return Array.from({ length: n }, (_, i) => {
    const order = i + 1;
    const [nodeId, name] = names[order] ?? [`N${order}`, `정류장${order}`];
    return { order, nodeId, name, direction: order <= half ? 0 : 1, lat: 36, lng: 127 } as RouteStop;
  });
}

const ROUTE: Route = { routeId: "R1", routeNo: "106", routeType: "간선버스", startStop: "목원대학교", endStop: "비래동종점" };

describe("findDirect", () => {
  // 시청역은 21번(방향 0)과 60번(방향 1) 두 곳, 목적지는 25번(방향 0)과 56번(방향 1) 두 곳
  const stops = loopStops(80, 40, {
    21: ["A", "시청역"],
    60: ["B", "시청역"],
    25: ["X", "둔산경찰서"],
    56: ["Y", "둔산경찰서"],
  });

  it("이름이 같은 후보 중 실제로 이어지는 출발·도착 정류소를 고른다", () => {
    const r = findDirect(ROUTE, stops, ["A", "B"], ["X", "Y"])!;
    expect(r).toMatchObject({ fromNodeId: "A", toNodeId: "X", stopCount: 4, towards: "비래동종점", viaTurnaround: false });
    expect(r.nextStop).toBe("정류장22");
  });

  it("도착이 출발보다 앞에 있으면 직통이 아니다", () => {
    expect(findDirect(ROUTE, stops, ["B"], ["X"])).toBeUndefined();
  });

  it("종점 회차를 지나면 viaTurnaround", () => {
    const r = findDirect(ROUTE, stops, ["A"], ["Y"])!;
    expect(r).toMatchObject({ stopCount: 35, viaTurnaround: true });
  });

  it("노선에 없는 정류소면 undefined", () => {
    expect(findDirect(ROUTE, stops, ["없음"], ["X"])).toBeUndefined();
  });

  it("turnaroundOrder: 방향이 0→1로 바뀌는 첫 순번", () => {
    expect(turnaroundOrder(stops)).toBe(41);
    expect(turnaroundOrder(loopStops(10, 10))).toBeUndefined();
  });
});

describe("findTransfers", () => {
  // 위치: 환승 정류소 H 근처에 W(약 100m), 나머지는 서로 멀리 떨어져 있다
  const far = (n: number) => ({ lat: 36 + n * 0.01, lng: 127 });
  const H = { lat: 36.35, lng: 127.38 };
  const W = { lat: 36.3509, lng: 127.38 };
  const st = (order: number, nodeId: string, direction: 0 | 1, pos = far(order)): RouteStop => ({
    order, nodeId, name: nodeId, stopNo: `${nodeId}-no`, direction, ...pos,
  });
  const route = (routeId: string, routeNo: string): Route => ({ routeId, routeNo, startStop: "기점", endStop: "종점" });

  // A: 출발 O → H(방향 0) … 회차 후 H 맞은편 H2(방향 1)
  const A = { route: route("RA", "106"), stops: [st(1, "O", 0), st(2, "a2", 0), st(3, "H", 0, H), st(4, "a4", 1), st(5, "H2", 1, H)] };
  // B: H에서 타면 도착 D까지 2정류장
  const B = { route: route("RB", "703"), stops: [st(1, "b1", 0), st(2, "H", 0, H), st(3, "b3", 0), st(4, "D", 0)] };
  // C: H 근처 W에서 타면 D까지 1정류장 (걸어서 갈아타기)
  const C = { route: route("RC", "705"), stops: [st(1, "c1", 0), st(2, "W", 0, W), st(3, "D", 0)] };
  // R: D를 먼저 지나고 H는 그 뒤 → H에서 타면 D로 못 간다 (방향이 반대)
  const R = { route: route("RR", "999"), stops: [st(1, "D", 0), st(2, "r2", 0), st(3, "H", 0, H)] };
  // X: 출발 O에서 도착 D까지 바로 간다 → 직통이라 환승 경로에서 빠진다
  const X = { route: route("RX", "1"), stops: [st(1, "O", 0), st(2, "H", 0, H), st(3, "D", 0)] };

  it("같은 정류소 환승과 걸어서 갈아타기를 정류장 수 합이 적은 순으로", () => {
    const res = findTransfers([A], [B, C, R], ["O"], ["D"], { maxWalkM: 200, limit: 5 });
    expect(res.map((t) => [t.legs[0].routeNo, t.legs[1].routeNo, t.totalStops, t.sameStop])).toEqual([
      ["106", "705", 3, false],
      ["106", "703", 4, true],
    ]);
    expect(res[0].walkM).toBeGreaterThan(80);
    expect(res[0].walkM).toBeLessThan(120);
    expect(res[1].legs[0]).toMatchObject({ fromNodeId: "O", toNodeId: "H", toStopNo: "H-no", stopCount: 2 });
    expect(res[1].legs[1]).toMatchObject({ fromNodeId: "H", fromStopNo: "H-no", toNodeId: "D", stopCount: 2 });
  });

  it("maxWalkM이 0이면 같은 정류소 환승만", () => {
    const res = findTransfers([A], [B, C], ["O"], ["D"], { maxWalkM: 0, limit: 5 });
    expect(res.map((t) => t.legs[1].routeNo)).toEqual(["703"]);
  });

  it("반대 방향이라 이어지지 않는 노선은 나오지 않는다", () => {
    expect(findTransfers([A], [R], ["O"], ["D"], { maxWalkM: 200, limit: 5 })).toEqual([]);
  });

  it("직통 노선은 환승 경로에 넣지 않는다", () => {
    const res = findTransfers([A, X], [B, X], ["O"], ["D"], { maxWalkM: 0, limit: 5 });
    expect(res.map((t) => [t.legs[0].routeNo, t.legs[1].routeNo])).toEqual([["106", "703"]]);
  });

  it("limit만큼만 돌려준다", () => {
    expect(findTransfers([A], [B, C], ["O"], ["D"], { maxWalkM: 200, limit: 1 })).toHaveLength(1);
  });
});

describe("analyzeHeadway", () => {
  const stops = loopStops(80, 40);
  const bus = (vehicleNo: string, stopOrder: number): BusLocation => ({
    vehicleNo, stopOrder, stopName: `정류장${stopOrder}`, nodeId: `N${stopOrder}`, lat: 36, lng: 127,
  });
  const route = { ...ROUTE, intervalMin: { weekday: 10, saturday: 15, sunday: 20 } };
  const WEDNESDAY = new Date("2026-11-18T03:00:00Z"); // KST 수 12:00

  it("균등 간격 대비 비율과 추정 분을 계산한다 (몰림·공백 판단은 하지 않음)", () => {
    // 4대 → 균등 간격 20정류장
    const r = analyzeHeadway({ routeId: "R1", route, stops, now: WEDNESDAY, buses: [bus("D", 70), bus("A", 5), bus("C", 30), bus("B", 8)] });
    expect(r.idealGapStops).toBe(20);
    expect(r.scheduledIntervalMin).toBe(10);
    expect(r.buses.map((b) => b.vehicleNo)).toEqual(["A", "B", "C", "D"]);
    expect(r.gaps).toEqual([
      { behind: "A", ahead: "B", fromOrder: 5, toOrder: 8, gapStops: 3, ratio: 0.15, estMin: 2, crossesTurnaround: false, crossesOrigin: false },
      { behind: "B", ahead: "C", fromOrder: 8, toOrder: 30, gapStops: 22, ratio: 1.1, estMin: 11, crossesTurnaround: false, crossesOrigin: false },
      { behind: "C", ahead: "D", fromOrder: 30, toOrder: 70, gapStops: 40, ratio: 2, estMin: 20, crossesTurnaround: true, crossesOrigin: false },
      // 순환: D(70) → 기점 → A(5) = 80 - 70 + 5
      { behind: "D", ahead: "A", fromOrder: 70, toOrder: 5, gapStops: 15, ratio: 0.75, estMin: 8, crossesTurnaround: false, crossesOrigin: true },
    ]);
    // 간격의 합은 노선 정류장 수와 같다
    expect(r.gaps.reduce((s, g) => s + g.gapStops, 0)).toBe(80);
  });

  it("위치 정보가 없는 차량은 간격 계산에서 빼고 따로 알려준다 (실제 리포트에서 발견된 버그)", () => {
    const ghost: BusLocation = { vehicleNo: "X", lat: 36, lng: 127 }; // nodeord·nodenm 없음
    const r = analyzeHeadway({ routeId: "R1", route, stops, now: WEDNESDAY, buses: [bus("A", 10), ghost, bus("B", 50)] });
    expect(r.busCount).toBe(2);
    expect(r.idealGapStops).toBe(40);
    expect(r.unlocatedBuses).toEqual(["X"]);
    expect(r.buses.map((b) => b.vehicleNo)).toEqual(["A", "B"]);
    expect(r.gaps.every((g) => Number.isFinite(g.gapStops))).toBe(true);
    expect(r.notes.join()).toContain("X");
  });

  it("요일별 배차간격을 고른다 (KST 기준)", () => {
    // 금요일 15:30 UTC = 토요일 00:30 KST
    const r = analyzeHeadway({ routeId: "R1", route, stops, now: new Date("2026-11-20T15:30:00Z"), buses: [bus("A", 1), bus("B", 21)] });
    expect(r.dayType).toBe("saturday");
    expect(r.scheduledIntervalMin).toBe(15);
    expect(r.notes.some((n) => n.includes("공휴일"))).toBe(true);
  });

  it("버스가 1대 이하면 간격 없이 사유를 남긴다", () => {
    const r = analyzeHeadway({ routeId: "R1", route, stops, now: WEDNESDAY, buses: [bus("A", 1)] });
    expect(r.gaps).toEqual([]);
    expect(r.notes.join()).toContain("1대뿐");
  });

  it("배차간격 정보가 없으면 estMin을 생략한다", () => {
    const r = analyzeHeadway({ routeId: "R1", stops, now: WEDNESDAY, buses: [bus("A", 1), bus("B", 41)] });
    expect(r.gaps[0].estMin).toBeUndefined();
    expect(r.gaps[0].ratio).toBe(1);
  });

  it("analyzedAt은 KST로 표기한다", () => {
    const r = analyzeHeadway({ routeId: "R1", stops, now: new Date("2026-11-20T15:30:00Z"), buses: [] });
    expect(r.analyzedAt).toBe("2026-11-21 00:30 KST");
  });

  it("dayTypeKst", () => {
    expect(dayTypeKst(new Date("2026-11-22T14:59:00Z"))).toBe("sunday"); // KST 일 23:59
    expect(dayTypeKst(new Date("2026-11-22T15:00:00Z"))).toBe("weekday"); // KST 월 00:00
  });
});

describe("분석 도구 (MCP)", () => {
  const raw = (order: number, nodeid: string, nodenm: string, updowncd: 0 | 1) => ({
    nodeid, nodenm, nodeord: order, updowncd, gpslati: 36, gpslong: 127,
  });
  const routeA = { routeid: "RA", routeno: 106, routetp: "간선버스", startnodenm: "목원대학교", endnodenm: "비래동종점" };
  const routeB = { routeid: "RB", routeno: 617, routetp: "간선버스", startnodenm: "가장제일장로교회", endnodenm: "비래동종점" };

  const routes = {
    // 시청역 A는 두 노선이, B는 106만 지난다
    getSttnThrghRouteList: (url: URL) => okResponse(url.searchParams.get("nodeid") === "A" ? [routeA, routeB] : routeA),
    getRouteAcctoThrghSttnList: (url: URL) =>
      url.searchParams.get("routeId") === "RA"
        ? okResponse([raw(1, "S", "목원대학교", 0), raw(2, "A", "시청역", 0), raw(5, "X", "목련아파트", 0), raw(6, "T", "비래동", 1), raw(9, "B", "시청역", 1)])
        : okResponse([raw(1, "A", "시청역", 0), raw(2, "Q", "법원", 0), raw(3, "R", "검찰청", 0), raw(7, "X", "목련아파트", 0)]),
    getRouteInfoIem: okResponse({ ...routeA, intervaltime: 10, intervalsattime: 15, intervalsuntime: 20 }, 0),
    getRouteAcctoBusLcList: okResponse([
      { vehicleno: "대전75자1", nodeid: "S", nodenm: "목원대학교", nodeord: 1, gpslati: 36, gpslong: 127 },
      { vehicleno: "대전75자2", nodeid: "A", nodenm: "시청역", nodeord: 2, gpslati: 36, gpslong: 127 },
    ]),
  };

  it("find_direct_routes: 후보 정류소를 모두 받아 이동 정류장 수가 적은 순으로", async () => {
    const { client } = await connectWith(routes);
    const res = parse(
      await client.callTool({ name: "find_direct_routes", arguments: { cityCode: 25, fromNodeIds: ["A", "B"], toNodeIds: ["X"] } }),
    );
    expect(res.map((r: any) => [r.routeNo, r.fromNodeId, r.stopCount])).toEqual([
      ["106", "A", 3],
      ["617", "A", 6],
    ]);
  });

  it("find_direct_routes: 정류소 후보는 최대 5개", async () => {
    const { client } = await connectWith(routes);
    const res: any = await client.callTool({
      name: "find_direct_routes",
      arguments: { cityCode: 25, fromNodeIds: ["1", "2", "3", "4", "5", "6"], toNodeIds: ["X"] },
    });
    expect(res.isError).toBe(true);
  });

  it("find_transfer_routes: 출발·도착 쪽 노선을 대조해 환승 경로와 조회 범위를 돌려준다", async () => {
    const { client } = await connectWith({
      getSttnThrghRouteList: (url: URL) => okResponse(url.searchParams.get("nodeid") === "O" ? routeA : routeB),
      getRouteAcctoThrghSttnList: (url: URL) =>
        url.searchParams.get("routeId") === "RA"
          ? okResponse([raw(1, "O", "목원대학교", 0), raw(20, "H", "대전광역시청", 0), raw(40, "T", "비래동종점", 1)])
          : okResponse([raw(82, "H", "대전광역시청", 1), raw(110, "D", "신탄진역", 1)]),
    });
    const res = parse(
      await client.callTool({ name: "find_transfer_routes", arguments: { cityCode: 25, fromNodeIds: ["O"], toNodeIds: ["D"] } }),
    );
    expect(res.checkedRoutes).toEqual({ fromSide: 1, toSide: 1, truncated: false });
    expect(res.transfers).toHaveLength(1);
    expect(res.transfers[0]).toMatchObject({ totalStops: 47, sameStop: true, walkM: 0 });
    expect(res.transfers[0].legs.map((l: any) => [l.routeNo, l.fromStopName, l.toStopName, l.stopCount])).toEqual([
      ["106", "목원대학교", "대전광역시청", 19],
      ["617", "대전광역시청", "신탄진역", 28],
    ]);
  });

  it("analyze_headway: 주입한 시각의 요일로 배차간격을 적용한다", async () => {
    const { client } = await connectWith(routes, { now: () => new Date("2026-11-22T03:00:00Z") }); // KST 일요일
    const res = parse(await client.callTool({ name: "analyze_headway", arguments: { cityCode: 25, routeId: "RA" } }));
    expect(res).toMatchObject({ routeNo: "106", busCount: 2, totalStops: 5, dayType: "sunday", scheduledIntervalMin: 20 });
    expect(res.gaps).toHaveLength(2); // 앞뒤 간격 1 + 기점 통과 순환 간격 1
  });
});
