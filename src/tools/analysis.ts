import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findDirect, type DirectRoute } from "../analysis/direct.js";
import { analyzeHeadway } from "../analysis/headway.js";
import type { Route } from "../tago/routes.js";
import { cityCodeSchema, mapLimit, routeIdSchema, run, type ToolContext } from "./shared.js";

/** 직통 노선 탐색 시 경유 정류소를 조회할 최대 노선 수 (쿼터 보호) */
const MAX_ROUTES = 30;

const nodeIdsSchema = z
  .array(z.string().min(1))
  .min(1)
  .max(5)
  .describe("정류소 ID 목록. 이름이 같은 정류소(길 건너편 등)가 여러 개면 모두 넣으세요. 최대 5개");

export function registerAnalysisTools(server: McpServer, { stations, routes }: ToolContext, now: () => Date) {
  server.registerTool(
    "find_direct_routes",
    {
      title: "직통 노선 찾기",
      description:
        "출발 정류소에서 도착 정류소까지 갈아타지 않고 가는 버스 노선을 찾습니다(이동 정류장 수가 적은 순). " +
        "이름이 같은 출발·도착 후보를 모두 넘기면, 어느 쪽 정류소에서 타고 내려야 하는지(fromNodeId/toNodeId)까지 판별합니다. " +
        "환승 경로는 찾지 않습니다. 결과가 비어 있으면 직통 노선이 없는 것입니다. " +
        "viaTurnaround가 true면 종점에서 회차해 가는 경로라 안내 시 언급하세요.",
      inputSchema: {
        cityCode: cityCodeSchema,
        fromNodeIds: nodeIdsSchema,
        toNodeIds: nodeIdsSchema,
      },
    },
    async ({ cityCode, fromNodeIds, toNodeIds }) =>
      run(async () => {
        // 출발 후보들을 지나는 노선을 모은다 (중복 제거)
        const routeLists = await mapLimit(fromNodeIds, 5, (id) => stations.getRoutesAtStop(cityCode, id));
        const unique = new Map<string, Route>();
        for (const r of routeLists.flat()) unique.set(r.routeId, r);
        const candidates = [...unique.values()].slice(0, MAX_ROUTES);

        const results = await mapLimit(candidates, 5, async (route) => {
          const stops = await routes.getRouteStops(cityCode, route.routeId);
          return findDirect(route, stops, fromNodeIds, toNodeIds);
        });
        return results
          .filter((r): r is DirectRoute => r !== undefined)
          .sort((a, b) => a.stopCount - b.stopCount);
      }),
  );

  server.registerTool(
    "analyze_headway",
    {
      title: "노선 운행 간격 분석",
      description:
        "노선에서 운행 중인 버스들의 앞뒤 차 간격을 계산합니다. 각 간격의 정류장 수(gapStops), " +
        "균등 배치 대비 비율(ratio, 1이 균등), 추정 시간 간격(estMin, 분)을 돌려줍니다. " +
        "ratio가 작으면 앞차와 붙어 있는 것(몰림)이고, 크면 간격이 벌어진 것(공백)입니다. " +
        "판단 기준은 이 도구가 정하지 않으니, 결과의 notes에 적힌 가정과 한계를 함께 안내하세요.",
      inputSchema: { cityCode: cityCodeSchema, routeId: routeIdSchema },
    },
    async ({ cityCode, routeId }) =>
      run(async () => {
        const [route, stops, buses] = await Promise.all([
          routes.getRouteInfo(cityCode, routeId),
          routes.getRouteStops(cityCode, routeId),
          routes.getBusLocations(cityCode, routeId),
        ]);
        return analyzeHeadway({ routeId, route, stops, buses, now: now() });
      }),
  );
}
