import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MemoryCache, type Cache } from "./cache.js";
import type { DataGoKrClient } from "./datagokr/client.js";
import { TagoArrivals } from "./tago/arrivals.js";
import { TagoRoutes } from "./tago/routes.js";
import { TagoStations } from "./tago/stations.js";
import { registerArrivalTools } from "./tools/arrivals.js";
import { registerRouteTools } from "./tools/routes.js";
import type { ToolContext } from "./tools/shared.js";
import { registerStopTools } from "./tools/stops.js";

export interface ServerDeps {
  client: DataGoKrClient;
  cache?: Cache;
}

// 버전은 package.json 하나만 고치면 되도록 런타임에 읽는다 (src/·dist/ 모두 한 단계 위가 패키지 루트)
const pkg = createRequire(import.meta.url)("../package.json") as { name: string; version: string };

export const SERVER_INFO = { name: pkg.name, version: pkg.version };

export function createServer({ client, cache = new MemoryCache() }: ServerDeps): McpServer {
  const server = new McpServer(SERVER_INFO);
  const ctx: ToolContext = {
    stations: new TagoStations(client, cache),
    arrivals: new TagoArrivals(client, cache),
    routes: new TagoRoutes(client, cache),
  };

  registerStopTools(server, ctx);
  registerArrivalTools(server, ctx);
  registerRouteTools(server, ctx);

  return server;
}
