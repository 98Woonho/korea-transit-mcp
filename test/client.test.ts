import { describe, expect, it } from "vitest";
import { DataGoKrClient, DataGoKrError, normalizeItems } from "../src/datagokr/client.js";
import { fakeFetch, okResponse } from "./helpers.js";

describe("normalizeItems", () => {
  it("빈 문자열(0건)은 빈 배열", () => expect(normalizeItems("")).toEqual([]));
  it("단일 객체(1건)는 배열로 감싼다", () => expect(normalizeItems({ item: { a: 1 } })).toEqual([{ a: 1 }]));
  it("배열은 그대로", () => expect(normalizeItems({ item: [{ a: 1 }, { a: 2 }] })).toHaveLength(2));
});

describe("DataGoKrClient", () => {
  it("serviceKey와 _type=json을 쿼리에 넣는다", async () => {
    const { fetch, calls } = fakeFetch({ op: okResponse([{ x: 1 }]) });
    const client = new DataGoKrClient({ serviceKey: "abc+/=", fetch });
    const res = await client.getList("/svc/op", { cityCode: 25, empty: undefined });

    expect(res.items).toEqual([{ x: 1 }]);
    expect(calls[0].searchParams.get("serviceKey")).toBe("abc+/="); // 한 번만 인코딩됨
    expect(calls[0].searchParams.get("_type")).toBe("json");
    expect(calls[0].searchParams.has("empty")).toBe(false);
  });

  it("인증키가 없으면 네트워크 호출 없이 오류", async () => {
    const { fetch, calls } = fakeFetch({});
    const client = new DataGoKrClient({ serviceKey: undefined, fetch });
    await expect(client.getList("/svc/op")).rejects.toMatchObject({ code: "NO_SERVICE_KEY" });
    expect(calls).toHaveLength(0);
  });

  it("게이트웨이 XML 오류를 해석한다", async () => {
    const xml =
      "<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg>" +
      "<returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg>" +
      "<returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>";
    const { fetch } = fakeFetch({ op: xml });
    const client = new DataGoKrClient({ serviceKey: "k", fetch });
    const err = await client.getList("/svc/op").catch((e) => e);
    expect(err).toBeInstanceOf(DataGoKrError);
    expect(err.code).toBe("30");
    expect(err.message).toContain("SERVICE_KEY_IS_NOT_REGISTERED_ERROR");
  });

  it("일시적 오류(99 세션 포화)는 재시도해서 성공한다", async () => {
    let n = 0;
    const fetch = async () => {
      n++;
      const body =
        n < 3
          ? { response: { header: { resultCode: "99", resultMsg: "가용한 세션이 존재하지 않습니다. (30/30)" } } }
          : okResponse([{ x: 1 }]);
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const client = new DataGoKrClient({ serviceKey: "k", fetch, retryDelaysMs: [0, 0] });
    expect((await client.getList("/svc/op")).items).toEqual([{ x: 1 }]);
    expect(n).toBe(3);
  });

  it("재시도 횟수를 넘기면 마지막 오류를 던진다", async () => {
    let n = 0;
    const fetch = async () => {
      n++;
      return new Response("bad gateway", { status: 502 });
    };
    const client = new DataGoKrClient({ serviceKey: "k", fetch, retryDelaysMs: [0, 0] });
    await expect(client.getList("/svc/op")).rejects.toMatchObject({ code: "HTTP_502" });
    expect(n).toBe(3);
  });

  it("인증키 오류·한도 초과는 재시도하지 않는다", async () => {
    let n = 0;
    const fetch = async () => {
      n++;
      return new Response(JSON.stringify({ response: { header: { resultCode: "22", resultMsg: "LIMITED" } } }), { status: 200 });
    };
    const client = new DataGoKrClient({ serviceKey: "k", fetch, retryDelaysMs: [0, 0] });
    await expect(client.getList("/svc/op")).rejects.toMatchObject({ code: "22" });
    expect(n).toBe(1);
  });

  it("JSON resultCode 오류를 던진다", async () => {
    const { fetch } = fakeFetch({
      op: { response: { header: { resultCode: "22", resultMsg: "LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS ERROR." } } },
    });
    const client = new DataGoKrClient({ serviceKey: "k", fetch });
    await expect(client.getList("/svc/op")).rejects.toMatchObject({ code: "22" });
  });
});
