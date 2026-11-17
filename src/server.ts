import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MemoryCache, type Cache } from "./cache.js";
import { DataGoKrClient, DataGoKrError } from "./datagokr/client.js";
import { TagoArrivals } from "./tago/arrivals.js";
import { TagoStations } from "./tago/stations.js";

export interface ServerDeps {
  client: DataGoKrClient;
  cache?: Cache;
}

export const SERVER_INFO = { name: "korea-transit-mcp", version: "0.1.0" } as const;

export function createServer({ client, cache = new MemoryCache() }: ServerDeps): McpServer {
  const server = new McpServer(SERVER_INFO);
  const stations = new TagoStations(client, cache);
  const arrivals = new TagoArrivals(client, cache);

  server.registerTool(
    "list_cities",
    {
      title: "도시 코드 조회",
      description:
        "국토교통부(TAGO) 버스 API가 지원하는 도시와 도시 코드(cityCode)를 조회합니다. " +
        "다른 버스 도구를 호출하기 전에 cityCode를 알아내는 데 사용하세요. " +
        "query를 주면 도시명에 해당 문자열이 포함된 것만 돌려줍니다. 서울특별시는 TAGO에서 지원하지 않습니다.",
      inputSchema: {
        query: z.string().optional().describe("도시명 일부. 예: '청주', '부산'"),
      },
    },
    async ({ query }) =>
      run(async () => {
        const cities = await stations.listCities();
        return query ? cities.filter((c) => c.cityName.includes(query)) : cities;
      }),
  );

  server.registerTool(
    "search_bus_stops",
    {
      title: "버스 정류소 검색",
      description:
        "도시 코드와 정류소명(또는 정류소 번호)으로 버스 정류소를 검색합니다. " +
        "결과의 nodeId는 도착 정보 조회 등 다른 도구에서 사용됩니다.",
      inputSchema: {
        cityCode: z.number().int().describe("list_cities로 얻은 도시 코드"),
        name: z.string().min(1).optional().describe("정류소명 일부. 예: '시청'"),
        stopNo: z.string().optional().describe("정류소 번호"),
        limit: z.number().int().min(1).max(100).default(20).describe("최대 결과 수"),
      },
    },
    async (input) =>
      run(async () => {
        if (!input.name && !input.stopNo) {
          throw new DataGoKrError("name 또는 stopNo 중 하나는 필요합니다.", "INVALID_INPUT");
        }
        return stations.searchStops(input);
      }),
  );

  server.registerTool(
    "get_bus_arrivals",
    {
      title: "실시간 버스 도착 정보",
      description:
        "정류소에 도착 예정인 버스를 도착이 빠른 순으로 조회합니다. " +
        "nodeId는 search_bus_stops 결과에서 얻습니다. routeId를 주면 해당 노선만 조회합니다. " +
        "arrivalMin은 남은 시간(분), stopsAway는 몇 정류장 전인지입니다. 결과가 비어 있으면 현재 운행 중인 도착 예정 버스가 없는 것입니다.",
      inputSchema: {
        cityCode: z.number().int().describe("도시 코드"),
        nodeId: z.string().min(1).describe("정류소 ID. 예: 'DJB8001378'"),
        routeId: z.string().optional().describe("특정 노선 ID (선택)"),
      },
    },
    async (input) => run(() => arrivals.getArrivals(input)),
  );

  return server;
}

/** 결과를 MCP 텍스트 콘텐츠로 감싸고, 오류는 isError로 돌려준다 (예외로 던지면 LLM이 원인을 못 본다). */
async function run(fn: () => Promise<unknown>) {
  try {
    const data = await fn();
    return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text" as const, text: message }], isError: true };
  }
}
