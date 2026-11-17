import { describe, expect, it } from "vitest";
import { findDirect, turnaroundOrder } from "../src/analysis/direct.js";
import { analyzeHeadway, dayTypeKst } from "../src/analysis/headway.js";
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
      { behind: "A", ahead: "B", fromOrder: 5, toOrder: 8, gapStops: 3, ratio: 0.15, estMin: 2, crossesTurnaround: false },
      { behind: "B", ahead: "C", fromOrder: 8, toOrder: 30, gapStops: 22, ratio: 1.1, estMin: 11, crossesTurnaround: false },
      { behind: "C", ahead: "D", fromOrder: 30, toOrder: 70, gapStops: 40, ratio: 2, estMin: 20, crossesTurnaround: true },
    ]);
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

  it("analyze_headway: 주입한 시각의 요일로 배차간격을 적용한다", async () => {
    const { client } = await connectWith(routes, { now: () => new Date("2026-11-22T03:00:00Z") }); // KST 일요일
    const res = parse(await client.callTool({ name: "analyze_headway", arguments: { cityCode: 25, routeId: "RA" } }));
    expect(res).toMatchObject({ routeNo: "106", busCount: 2, totalStops: 5, dayType: "sunday", scheduledIntervalMin: 20 });
    expect(res.gaps).toHaveLength(1);
  });
});
