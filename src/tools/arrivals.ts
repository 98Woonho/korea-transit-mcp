import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cityCodeSchema, nodeIdSchema, run, type ToolContext } from "./shared.js";

export function registerArrivalTools(server: McpServer, { arrivals }: ToolContext) {
  server.registerTool(
    "get_bus_arrivals",
    {
      title: "실시간 버스 도착 정보",
      description:
        "정류소에 도착 예정인 버스를 도착이 빠른 순으로 조회합니다. " +
        "nodeId는 search_bus_stops 결과에서 얻습니다. routeId를 주면 해당 노선만 조회합니다. " +
        "arrivalMin은 남은 시간(분, 반올림), stopsAway는 몇 정류장 전인지입니다. " +
        "arrivingSoon이 true이면 1분 이내이므로 분 대신 '곧 도착'으로 안내하세요. " +
        "결과가 비어 있으면 현재 운행 중인 도착 예정 버스가 없는 것입니다.",
      inputSchema: {
        cityCode: cityCodeSchema,
        nodeId: nodeIdSchema,
        routeId: z.string().optional().describe("특정 노선 ID (선택)"),
      },
    },
    async (input) => run(() => arrivals.getArrivals(input)),
  );
}
