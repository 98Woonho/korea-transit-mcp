/**
 * 노선·위치·주변 정류소·경유 노선 도구 테스트.
 * 응답 필드와 값은 2026-11-17 대전(cityCode 25) 106번 노선 실제 응답을 바탕으로 했다.
 */
import { describe, expect, it } from "vitest";
import { toHHMM } from "../src/tago/routes.js";
import { distanceMeters } from "../src/tago/stations.js";
import { mapLimit } from "../src/tools/shared.js";
import { connectWith, okResponse, parse } from "./helpers.js";

const ROUTE_106 = {
  endnodenm: "비래동종점",
  endvehicletime: 2230, // 숫자로 온다
  routeid: "DJB30300041",
  routeno: 106,
  routetp: "간선버스",
  startnodenm: "목원대학교",
  startvehicletime: "0545", // 문자열로 온다
};

const stop = (ord: number, nodeid: string, nodenm: string, updowncd: 0 | 1) => ({
  gpslati: 36.35,
  gpslong: 127.38,
  nodeid,
  nodenm,
  nodeno: 30000 + ord,
  nodeord: ord,
  routeid: "DJB30300041",
  updowncd,
});

const routes = {
  getRouteNoList: okResponse(ROUTE_106), // 1건 → 객체
  getRouteInfoIem: okResponse({ ...ROUTE_106, intervaltime: 11, intervalsattime: 14, intervalsuntime: 14 }, 0), // totalCount 0 인데 item 있음
  getRouteAcctoThrghSttnList: okResponse([
    // 일부러 순서를 섞어서 order 정렬을 검증
    stop(21, "DJB8002088", "시청역", 0),
    stop(20, "DJB8001378", "대전광역시청", 0),
    stop(22, "DJB8000001", "둔산경찰서", 0),
    stop(60, "DJB8002969", "시청역", 1),
    stop(61, "DJB8002087", "시청.교육청", 1),
  ]),
  // 길 건너편 두 시청역 모두 같은 노선 목록을 준다 (방향 정보 없음)
  getSttnThrghRouteList: okResponse({
    endnodenm: "비래동종점",
    routeid: "DJB30300041",
    routeno: 106,
    routetp: "간선버스",
    startnodenm: "목원대학교",
  }),
  getRouteAcctoBusLcList: okResponse([
    { gpslati: 36.359, gpslong: 127.354, nodeid: "DJB8002969", nodenm: "시청역", nodeord: 60, routenm: 106, routetp: "간선버스", vehicleno: "대전75자3326" },
    { gpslati: 36.342, gpslong: 127.339, nodeid: "DJB8001378", nodenm: "대전광역시청", nodeord: 20, routenm: 106, routetp: "간선버스", vehicleno: "대전75자3327" },
  ]),
  getCrdntPrxmtSttnList: okResponse([
    { citycode: 25, gpslati: 36.351566, gpslong: 127.38445, nodeid: "DJB9002089", nodenm: "시청환승지" },
    { citycode: 25, gpslati: 36.351112, gpslong: 127.38486, nodeid: "DJB8001378", nodenm: "대전광역시청", nodeno: 32350 },
    { citycode: 12, gpslati: 36.3511393, gpslong: 127.3851554, nodeid: "SJB186005227", nodenm: "대전광역시청", nodeno: 32350 },
  ]),
};

const connect = () => connectWith(routes);

describe("노선 도구", () => {
  it("search_routes: 1건 응답을 배열로, 첫차·막차를 HH:MM으로", async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: "search_routes", arguments: { cityCode: 25, routeNo: "106" } });
    expect(parse(res)).toEqual([
      {
        routeId: "DJB30300041",
        routeNo: "106",
        routeType: "간선버스",
        startStop: "목원대학교",
        endStop: "비래동종점",
        firstBus: "05:45",
        lastBus: "22:30",
      },
    ]);
  });

  it("get_route_info: totalCount가 0이어도 item을 읽고 배차간격을 준다", async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: "get_route_info", arguments: { cityCode: 25, routeId: "DJB30300041" } });
    expect(parse(res).intervalMin).toEqual({ weekday: 11, saturday: 14, sunday: 14 });
  });

  it("get_route_stops: 순번 정렬, 좌표는 응답에서 뺀다", async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: "get_route_stops", arguments: { cityCode: 25, routeId: "DJB30300041" } });
    const stops = parse(res);
    expect(stops.map((s: any) => s.order)).toEqual([20, 21, 22, 60, 61]);
    expect(stops[0]).toEqual({ order: 20, nodeId: "DJB8001378", name: "대전광역시청", stopNo: "30020", direction: 0 });
  });

  it("get_bus_locations: 노선 경유 정류소와 합쳐 향하는 종점을 붙인다", async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: "get_bus_locations", arguments: { cityCode: 25, routeId: "DJB30300041" } });
    expect(parse(res)).toEqual([
      { vehicleNo: "대전75자3327", stopName: "대전광역시청", stopOrder: 20, nodeId: "DJB8001378", towards: "비래동종점" },
      { vehicleNo: "대전75자3326", stopName: "시청역", stopOrder: 60, nodeId: "DJB8002969", towards: "목원대학교" },
    ]);
  });
});

describe("정류소 도구", () => {
  it("get_routes_at_stop: 이름이 같은 길 건너편 정류소를 방향으로 구분한다", async () => {
    const { client, calls } = await connect();
    const a = parse(await client.callTool({ name: "get_routes_at_stop", arguments: { cityCode: 25, nodeId: "DJB8002088" } }));
    const b = parse(await client.callTool({ name: "get_routes_at_stop", arguments: { cityCode: 25, nodeId: "DJB8002969" } }));

    expect(a[0]).toMatchObject({ routeNo: "106", nextStop: "둔산경찰서", towards: "비래동종점" });
    expect(b[0]).toMatchObject({ routeNo: "106", nextStop: "시청.교육청", towards: "목원대학교" });

    // 이 오퍼레이션만 파라미터가 소문자 nodeid
    const stopRoutesCall = calls.find((u) => u.pathname.endsWith("getSttnThrghRouteList"))!;
    expect(stopRoutesCall.searchParams.get("nodeid")).toBe("DJB8002088");
    // 노선 경유 정류소는 두 번째 정류소 조회 때 캐시를 쓴다
    expect(calls.filter((u) => u.pathname.endsWith("getRouteAcctoThrghSttnList"))).toHaveLength(1);
  });

  it("find_nearby_stops: 가까운 순 정렬, 거리(m)와 cityCode 포함", async () => {
    const { client, calls } = await connect();
    const res = parse(
      await client.callTool({ name: "find_nearby_stops", arguments: { lat: 36.351112, lng: 127.38486, limit: 2 } }),
    );
    expect(res).toHaveLength(2);
    expect(res[0]).toMatchObject({ nodeId: "DJB8001378", distanceM: 0, cityCode: 25 });
    expect(res[1].distanceM).toBeGreaterThan(0);
    expect(calls[0].searchParams.get("gpsLati")).toBe("36.3511"); // 캐시 적중률을 위한 반올림
  });
});

describe("유틸", () => {
  it("toHHMM", () => {
    expect(toHHMM("0545")).toBe("05:45");
    expect(toHHMM(2230)).toBe("22:30");
    expect(toHHMM(545)).toBe("05:45");
    expect(toHHMM("")).toBeUndefined();
    expect(toHHMM("abc")).toBeUndefined();
  });

  it("distanceMeters: 위도 0.001도 ≈ 111m", () => {
    expect(Math.round(distanceMeters(36, 127, 36.001, 127))).toBe(111);
  });

  it("mapLimit: 순서를 유지하고 동시 실행 수를 제한한다", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBe(2);
  });
});
