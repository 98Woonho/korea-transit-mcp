/**
 * MCP 프로토콜 레벨 통합 테스트.
 * 실제 MCP 클라이언트를 메모리 트랜스포트로 서버에 연결해서 tools/list, tools/call 을 검증한다.
 * 네트워크와 LLM을 전혀 쓰지 않으므로 CI에서 비용 0원으로 돈다.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { DataGoKrClient } from "../src/datagokr/client.js";
import { createServer } from "../src/server.js";
import { fakeFetch, okResponse } from "./helpers.js";

const routes = {
  getCtyCodeList: okResponse([
    { citycode: 33010, cityname: "청주시" },
    { citycode: 21, cityname: "부산광역시" },
  ]),
  getSttnNoList: (url: URL) =>
    url.searchParams.get("cityCode") === "25"
      ? // 2026-11-17 실제 응답(대전, "시청")의 순서 그대로 — API는 nodeId 순으로 준다
        okResponse([
          { nodeid: "DJB8001378", nodenm: "대전광역시청", nodeno: 32350, gpslati: 36.351112, gpslong: 127.38486 },
          { nodeid: "DJB8002087", nodenm: "시청.교육청", nodeno: 32310, gpslati: 36.351395, gpslong: 127.3835 },
          { nodeid: "DJB8002088", nodenm: "시청역", nodeno: 32410, gpslati: 36.351147, gpslong: 127.38868 },
          { nodeid: "DJB8002089", nodenm: "시청환승지", nodeno: 32340, gpslati: 36.352467, gpslong: 127.38446 },
          { nodeid: "DJB8005048", nodenm: "계룡시청", nodeno: 73800, gpslati: 36.273994, gpslong: 127.251724 },
        ])
      : okResponse([
          { nodeid: "CJB283000001", nodenm: "청주시청", nodeno: 10001, gpslati: 36.6424, gpslong: 127.4890, citycode: 33010 },
        ]),
  // 2026-11-17 실제 응답(대전광역시청)에서 가져온 형태
  getSttnAcctoArvlPrearngeInfoList: okResponse([
    { arrprevstationcnt: 4, arrtime: 329, nodeid: "DJB8001378", nodenm: "대전광역시청", routeid: "DJB30300039", routeno: 104, routetp: "간선버스", vehicletp: "저상버스" },
    { arrprevstationcnt: 2, arrtime: 156, nodeid: "DJB8001378", nodenm: "대전광역시청", routeid: "DJB30300041", routeno: 106, routetp: "간선버스", vehicletp: "일반차량" },
    { arrprevstationcnt: 1, arrtime: 22, nodeid: "DJB8001378", nodenm: "대전광역시청", routeid: "DJB30300081", routeno: 617, routetp: "간선버스", vehicletp: "저상버스" },
  ]),
  // 1건이면 item 이 배열이 아닌 객체로 온다
  getSttnAcctoSpcifyRouteBusArvlPrearngeInfoList: okResponse(
    { arrprevstationcnt: 5, arrtime: 476, nodeid: "DJB8001378", nodenm: "대전광역시청", routeid: "DJB30300060", routeno: 316, routetp: "간선버스", vehicletp: "저상버스" },
  ),
};

async function connect({ serviceKey = "test-key" as string | undefined } = {}) {
  const fake = fakeFetch(routes);
  const server = createServer({ client: new DataGoKrClient({ serviceKey, fetch: fake.fetch }) });
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return { client, calls: fake.calls };
}

const parse = (res: any) => JSON.parse(res.content[0].text);

describe("korea-transit-mcp", () => {
  it("도구 목록을 노출한다", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["get_bus_arrivals", "list_cities", "search_bus_stops"]);
  });

  it("get_bus_arrivals: 도착이 빠른 순으로 정렬하고 분 단위를 붙인다", async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: "get_bus_arrivals", arguments: { cityCode: 25, nodeId: "DJB8001378" } });
    expect(parse(res)).toEqual([
      { routeId: "DJB30300081", routeNo: "617", routeType: "간선버스", vehicleType: "저상버스", arrivalSec: 22, arrivalMin: 0, arrivingSoon: true, stopsAway: 1 },
      { routeId: "DJB30300041", routeNo: "106", routeType: "간선버스", vehicleType: "일반차량", arrivalSec: 156, arrivalMin: 3, arrivingSoon: false, stopsAway: 2 },
      { routeId: "DJB30300039", routeNo: "104", routeType: "간선버스", vehicleType: "저상버스", arrivalSec: 329, arrivalMin: 5, arrivingSoon: false, stopsAway: 4 },
    ]);
  });

  it("search_bus_stops: 후보를 넉넉히 받아 관련도 순으로 정렬하고, limit만 바뀐 재검색은 캐시를 쓴다", async () => {
    const { client, calls } = await connect();
    const res = await client.callTool({ name: "search_bus_stops", arguments: { cityCode: 25, name: "시청", limit: 3 } });
    expect(parse(res).map((s: any) => s.name)).toEqual(["시청역", "시청.교육청", "시청환승지"]);
    expect(calls[0].searchParams.get("numOfRows")).toBe("100");

    const more = await client.callTool({ name: "search_bus_stops", arguments: { cityCode: 25, name: "시청", limit: 10 } });
    expect(parse(more)).toHaveLength(5);
    expect(calls).toHaveLength(1);
  });

  it("get_bus_arrivals: routeId를 주면 노선 지정 오퍼레이션을 쓰고, 1건 응답도 배열로 준다", async () => {
    const { client, calls } = await connect();
    const res = await client.callTool({
      name: "get_bus_arrivals",
      arguments: { cityCode: 25, nodeId: "DJB8001378", routeId: "DJB30300060" },
    });
    expect(parse(res)).toHaveLength(1);
    expect(parse(res)[0].routeNo).toBe("316");
    expect(calls[0].pathname).toMatch(/getSttnAcctoSpcifyRouteBusArvlPrearngeInfoList$/);
    expect(calls[0].searchParams.get("routeId")).toBe("DJB30300060");
  });

  it("list_cities: query로 필터링하고, 두 번째 호출은 캐시를 쓴다", async () => {
    const { client, calls } = await connect();
    const res = await client.callTool({ name: "list_cities", arguments: { query: "청주" } });
    expect(parse(res)).toEqual([{ cityCode: 33010, cityName: "청주시" }]);

    await client.callTool({ name: "list_cities", arguments: {} });
    expect(calls).toHaveLength(1);
  });

  it("search_bus_stops: 원본 필드를 정규화해서 돌려준다", async () => {
    const { client, calls } = await connect();
    const res = await client.callTool({ name: "search_bus_stops", arguments: { cityCode: 33010, name: "시청" } });
    expect(parse(res)).toEqual([
      { nodeId: "CJB283000001", name: "청주시청", stopNo: "10001", lat: 36.6424, lng: 127.489, cityCode: 33010 },
    ]);
    expect(calls[0].searchParams.get("nodeNm")).toBe("시청");
  });

  it("검색어가 없으면 isError로 안내한다", async () => {
    const { client, calls } = await connect();
    const res: any = await client.callTool({ name: "search_bus_stops", arguments: { cityCode: 33010 } });
    expect(res.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("인증키가 없어도 서버는 뜨고, 호출 시 원인을 알려준다", async () => {
    const { client } = await connect({ serviceKey: "" });
    const res: any = await client.callTool({ name: "list_cities", arguments: {} });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("DATA_GO_KR_SERVICE_KEY");
  });
});
