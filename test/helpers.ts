import type { FetchLike } from "../src/datagokr/client.js";

/** 실제 네트워크 대신 경로별로 준비된 응답을 돌려주는 가짜 fetch. 호출 기록도 남긴다. */
export function fakeFetch(routes: Record<string, unknown | string>) {
  const calls: URL[] = [];
  const fn: FetchLike = async (input) => {
    const url = new URL(input);
    calls.push(url);
    const op = url.pathname.split("/").pop()!;
    if (!(op in routes)) return new Response("not found", { status: 404 });
    const body = routes[op];
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
