import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cityCodeSchema, mapLimit, nodeIdSchema, run, ToolInputError, type ToolContext } from "./shared.js";

/** 방향 계산을 위해 노선별 경유 정류소를 조회할 최대 노선 수 (쿼터 보호) */
const MAX_DIRECTION_LOOKUPS = 20;

export function registerStopTools(server: McpServer, { stations, routes }: ToolContext) {
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
        "결과는 이름이 검색어와 정확히 일치 → 앞부분 일치 → 포함 순으로 정렬됩니다. " +
        "같은 이름의 정류소가 여러 개면 도로 반대편 등 방향이 다른 정류소입니다(get_routes_at_stop으로 방향 확인). " +
        "하나의 도시 코드에 인접 시·군이 함께 묶여 있을 수 있습니다. " +
        "결과의 nodeId는 도착 정보 조회 등 다른 도구에서 사용됩니다.",
      inputSchema: {
        cityCode: cityCodeSchema,
        name: z.string().min(1).optional().describe("정류소명 일부. 예: '시청'"),
        stopNo: z.string().optional().describe("정류소 번호"),
        limit: z.number().int().min(1).max(100).default(20).describe("최대 결과 수"),
      },
    },
    async (input) =>
      run(async () => {
        if (!input.name && !input.stopNo) throw new ToolInputError("name 또는 stopNo 중 하나는 필요합니다.");
        return stations.searchStops(input);
      }),
  );

  server.registerTool(
    "find_nearby_stops",
    {
      title: "주변 정류소 찾기",
      description:
        "위도·경도 주변의 버스 정류소를 가까운 순으로 찾습니다(distanceM: 미터). 도시 코드가 필요 없고, 결과에 cityCode가 포함됩니다. " +
        "같은 정류소가 인접 도시 시스템에 중복 등록되어 cityCode만 다르게 두 번 나올 수 있습니다.",
      inputSchema: {
        lat: z.number().min(33).max(39).describe("위도. 예: 36.3511"),
        lng: z.number().min(124).max(132).describe("경도. 예: 127.3848"),
        limit: z.number().int().min(1).max(50).default(10).describe("최대 결과 수"),
      },
    },
    async ({ lat, lng, limit }) => run(() => stations.findNearby(lat, lng, limit)),
  );

  server.registerTool(
    "get_routes_at_stop",
    {
      title: "정류소 경유 노선",
      description:
        "정류소를 지나는 버스 노선 목록입니다. 각 노선에 이 정류소의 다음 정류소(nextStop)와 향하는 종점(towards)을 붙여 줍니다. " +
        "같은 이름의 정류소가 여러 개일 때 어느 쪽 방면인지 구분하는 데 사용하세요. " +
        `노선이 ${MAX_DIRECTION_LOOKUPS}개를 넘으면 방향 정보는 생략됩니다.`,
      inputSchema: {
        cityCode: cityCodeSchema,
        nodeId: nodeIdSchema,
      },
    },
    async ({ cityCode, nodeId }) =>
      run(async () => {
        const list = await stations.getRoutesAtStop(cityCode, nodeId);
        if (list.length > MAX_DIRECTION_LOOKUPS) return list;
        return mapLimit(list, 5, async (route) => ({
          ...route,
          ...(await routes.directionAtStop(cityCode, route, nodeId)),
        }));
      }),
  );
}
