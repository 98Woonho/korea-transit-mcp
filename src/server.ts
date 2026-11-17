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

export const SERVER_INFO = { name: "korea-transit-mcp", version: "0.2.0" } as const;

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
