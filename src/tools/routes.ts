import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cityCodeSchema, routeIdSchema, run, ToolInputError, type ToolContext } from "./shared.js";

export function registerRouteTools(server: McpServer, { routes }: ToolContext) {
  server.registerTool(
    "search_routes",
    {
      title: "버스 노선 검색",
      description:
        "노선 번호로 버스 노선을 검색합니다. 기점·종점과 첫차·막차 시각(HH:MM)을 함께 돌려줍니다. " +
        "결과의 routeId는 다른 노선 도구에서 사용됩니다. 같은 번호라도 지역·유형별로 여러 노선이 나올 수 있습니다.",
      inputSchema: {
        cityCode: cityCodeSchema,
        routeNo: z.string().min(1).describe("노선 번호. 예: '106', 'M1'"),
      },
    },
    async ({ cityCode, routeNo }) => run(() => routes.searchRoutes(cityCode, routeNo)),
  );

  server.registerTool(
    "get_route_info",
    {
      title: "버스 노선 상세",
      description:
        "노선의 기점·종점, 첫차·막차 시각, 배차간격(분: 평일/토요일/일요일·공휴일)을 조회합니다.",
      inputSchema: { cityCode: cityCodeSchema, routeId: routeIdSchema },
    },
    async ({ cityCode, routeId }) =>
      run(async () => {
        const info = await routes.getRouteInfo(cityCode, routeId);
        if (!info) throw new ToolInputError(`노선을 찾을 수 없습니다: ${routeId}`);
        return info;
      }),
  );

  server.registerTool(
    "get_route_stops",
    {
      title: "노선 경유 정류소",
      description:
        "노선이 지나는 정류소를 순서대로 조회합니다. direction이 0이면 기점→종점, 1이면 종점→기점 방향 구간입니다. " +
        "정류소가 수십~수백 개일 수 있으니 필요할 때만 호출하세요.",
      inputSchema: { cityCode: cityCodeSchema, routeId: routeIdSchema },
    },
    async ({ cityCode, routeId }) =>
      run(async () => {
        const stops = await routes.getRouteStops(cityCode, routeId);
        // 좌표는 빼서 응답 크기(=클라이언트 토큰)를 줄인다
        return stops.map(({ order, nodeId, name, stopNo, direction }) => ({ order, nodeId, name, stopNo, direction }));
      }),
  );

  server.registerTool(
    "get_bus_locations",
    {
      title: "실시간 버스 위치",
      description:
        "노선에서 현재 운행 중인 버스들의 위치(차량번호, 현재 정류소, 노선 내 순번)를 조회합니다. " +
        "towards는 그 버스가 향하는 종점 방향입니다. 결과가 비어 있으면 운행 중인 버스가 없는 것입니다.",
      inputSchema: { cityCode: cityCodeSchema, routeId: routeIdSchema },
    },
    async ({ cityCode, routeId }) =>
      run(async () => {
        const [buses, stops, info] = await Promise.all([
          routes.getBusLocations(cityCode, routeId),
          routes.getRouteStops(cityCode, routeId),
          routes.getRouteInfo(cityCode, routeId),
        ]);
        const dirByOrder = new Map(stops.map((s) => [s.order, s.direction]));
        return buses.map((b) => {
          const dir = b.stopOrder !== undefined ? dirByOrder.get(b.stopOrder) : undefined;
          const towards = dir === 0 ? info?.endStop : dir === 1 ? info?.startStop : undefined;
          return { vehicleNo: b.vehicleNo, stopName: b.stopName, stopOrder: b.stopOrder, nodeId: b.nodeId, towards };
        });
      }),
  );
}
