import { z } from "zod";
import type { TagoArrivals } from "../tago/arrivals.js";
import type { TagoRoutes } from "../tago/routes.js";
import type { TagoStations } from "../tago/stations.js";

/** 도구 등록 함수들이 공유하는 의존성 */
export interface ToolContext {
  stations: TagoStations;
  arrivals: TagoArrivals;
  routes: TagoRoutes;
}

export const cityCodeSchema = z.number().int().describe("list_cities로 얻은 도시 코드. 예: 25(대전)");
export const routeIdSchema = z.string().min(1).describe("노선 ID. search_routes 등에서 얻음. 예: 'DJB30300041'");
export const nodeIdSchema = z.string().min(1).describe("정류소 ID. search_bus_stops 등에서 얻음. 예: 'DJB8001378'");

export class ToolInputError extends Error {}

/** 결과를 MCP 텍스트 콘텐츠로 감싸고, 오류는 isError로 돌려준다 (예외로 던지면 LLM이 원인을 못 본다). */
export async function run(fn: () => Promise<unknown>) {
  try {
    const data = await fn();
    return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text" as const, text: message }], isError: true };
  }
}

/** 동시 실행 수를 제한한 map — 공공 API에 요청을 한꺼번에 몰아 보내지 않기 위함 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
