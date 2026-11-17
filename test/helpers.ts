import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DataGoKrClient, type FetchLike } from "../src/datagokr/client.js";
import { createServer } from "../src/server.js";

/** 가짜 fetch를 물린 서버에 실제 MCP 클라이언트를 메모리 트랜스포트로 연결한다 */
export async function connectWith(
  routes: Record<string, unknown>,
  { serviceKey = "test-key" as string | undefined, now }: { serviceKey?: string; now?: () => Date } = {},
) {
  const fake = fakeFetch(routes);
  const server = createServer({ client: new DataGoKrClient({ serviceKey, fetch: fake.fetch }), now });
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return { client, calls: fake.calls };
}

/** 도구 결과 텍스트(JSON)를 파싱 */
export const parse = (res: any) => JSON.parse(res.content[0].text);

/** 실제 네트워크 대신 경로별로 준비된 응답을 돌려주는 가짜 fetch. 호출 기록도 남긴다. */
export function fakeFetch(routes: Record<string, unknown>) {
  const calls: URL[] = [];
  const fn: FetchLike = async (input) => {
    const url = new URL(input);
    calls.push(url);
    const op = url.pathname.split("/").pop()!;
    if (!(op in routes)) return new Response("not found", { status: 404 });
    // 값이 함수면 요청 URL을 보고 응답을 고른다 (쿼리 파라미터별로 다른 응답이 필요할 때)
    const route = routes[op];
    const body = typeof route === "function" ? route(url) : route;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
  };
  return { fetch: fn, calls };
}

/** data.go.kr 표준 JSON 응답 껍데기 */
export function okResponse(item: unknown, totalCount?: number) {
  return {
    response: {
      header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
      body: {
        items: item === undefined ? "" : { item },
        numOfRows: 20,
        pageNo: 1,
        totalCount: totalCount ?? (Array.isArray(item) ? item.length : item === undefined ? 0 : 1),
      },
    },
  };
}
