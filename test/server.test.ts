/**
 * MCP 프로토콜 레벨 통합 테스트.
 * 실제 MCP 클라이언트를 메모리 트랜스포트로 서버에 연결해서 tools/list, tools/call 을 검증한다.
 * 네트워크와 LLM을 전혀 쓰지 않으므로 CI에서 비용 0원으로 돈다.
 */
import { readdirSync, readFileSync } from "node:fs";
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
    // npm run eval 이 허용하는 도구 목록과 실제 도구가 같아야 평가에서 도구가 막히지 않는다
    const evalTools = JSON.parse(readFileSync(new URL("../scripts/eval-tools.json", import.meta.url), "utf8"));
    expect([...evalTools].sort()).toEqual(tools.map((t) => t.name).sort());
    // 각 평가 케이스의 allowed_tools 에도 모든 도구가 있어야 한다 (새 도구를 빠뜨리면 그 케이스에서 막힌다)
    const evalRoot = new URL("../plugin/evals/", import.meta.url);
    const prompts = readdirSync(evalRoot, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith("prompt.md"));
    expect(prompts.length).toBeGreaterThan(0);
    for (const p of prompts) {
      const text = readFileSync(new URL(p.replaceAll("\\", "/"), evalRoot), "utf8");
      for (const name of evalTools) expect(text, p).toContain(`mcp__plugin_korea-transit_korea-transit__${name}`);
    }

    // 규칙 채점(tool_used / tool_order)이 실제 도구 이름과 올바른 정규식을 쓰는지
    const known = new Set(["Skill", "Read", ...evalTools.map((n: string) => `mcp__plugin_korea-transit_korea-transit__${n}`)]);
    const graders = readdirSync(evalRoot, { recursive: true, encoding: "utf8" }).filter(
      (f) => /graders[\\/].+\.md$/.test(f) && !/^results[\\/]/.test(f),
    );
    let ruleGraders = 0;
    for (const g of graders) {
      const head = readFileSync(new URL(g.replaceAll("\\", "/"), evalRoot), "utf8").match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
      const fm = Object.fromEntries(
        head.split("\n").map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim().replace(/^'(.*)'$/, "$1")]),
      );
      if (fm.type !== "tool_used" && fm.type !== "tool_order") continue;
      ruleGraders++;
      for (const k of ["tool", "before", "after"]) if (fm[k]) expect(known.has(fm[k]), `${g}: ${k}=${fm[k]}`).toBe(true);
      if (fm.input_match) expect(() => new RegExp(fm.input_match), g).not.toThrow();
      // CLI는 min 기본값이 1이라, "부르지 않아야 한다"(max 0)는 min 0을 함께 써야 통과할 수 있다
      if (fm.max !== undefined && Number(fm.max) < 1) expect(fm.min, `${g}: max 0 needs min 0`).toBe("0");
    }
    expect(ruleGraders).toBeGreaterThan(0);

    expect(tools.map((t) => t.name).sort()).toEqual([
      "analyze_headway",
      "find_direct_routes",
      "find_nearby_stops",
      "find_transfer_routes",
      "get_bus_arrivals",
      "get_bus_locations",
      "get_route_info",
      "get_route_stops",
      "get_routes_at_stop",
      "list_cities",
      "search_bus_stops",
      "search_routes",
    ]);
  });

  it("포트폴리오 소개 자료(showcase/)가 실제 도구·데모 파일과 맞는다", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const showcaseDir = new URL("../showcase/", import.meta.url);
    const showcase = JSON.parse(readFileSync(new URL("showcase.json", showcaseDir), "utf8"));

    // 도구 분류에 모든 도구가 정확히 한 번씩
    const grouped = showcase.toolGroups.flatMap((g: { tools: string[] }) => g.tools);
    expect([...grouped].sort()).toEqual(tools.map((t) => t.name).sort());

    // 데모 시나리오가 있고 필수 항목을 갖춘다
    expect(showcase.demos.length).toBeGreaterThan(0);
    for (const path of showcase.demos) {
      const demo = JSON.parse(readFileSync(new URL(path, showcaseDir), "utf8"));
      expect(demo, path).toMatchObject({ id: expect.any(String), title: expect.any(String), prompt: expect.any(String) });
      expect(demo.steps.length, path).toBeGreaterThan(0);
      expect(demo.answer.length, path).toBeGreaterThan(0);
    }
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
