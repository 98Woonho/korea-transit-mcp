/**
 * 공공데이터포털(data.go.kr) 공통 HTTP 클라이언트.
 *
 * data.go.kr API들은 대부분 같은 응답 껍데기를 공유한다:
 *   { response: { header: { resultCode, resultMsg }, body: { items: { item }, totalCount, ... } } }
 *
 * 그리고 공통적인 함정이 있다:
 *  - 결과가 1건이면 item 이 배열이 아니라 객체, 0건이면 items 가 빈 문자열("")로 온다.
 *  - 인증키 오류 등 게이트웨이 단 오류는 _type=json 을 줘도 XML로 온다.
 * 이 모듈은 그 차이를 흡수해서 항상 T[] 를 돌려준다.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class DataGoKrError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "DataGoKrError";
  }
}

export interface DataGoKrClientOptions {
  /** 공공데이터포털 인증키 (Decoding 키) */
  serviceKey: string | undefined;
  fetch?: FetchLike;
  baseUrl?: string;
  timeoutMs?: number;
  /** 일시적 오류 시 재시도 대기 시간(ms). 길이만큼 재시도한다. 기본 [500, 1500] */
  retryDelaysMs?: number[];
}

export interface ListResult<T> {
  items: T[];
  totalCount: number;
}

type Params = Record<string, string | number | undefined>;

const SUCCESS_CODES = new Set(["00", "0", "000"]);

/**
 * 잠시 뒤 다시 하면 성공할 수 있는 오류.
 *  - 99: "가용한 세션이 존재하지 않습니다 (30/30)" — 공공 API 서버 동시 세션 포화 (2026-11-17 실제 발생)
 *  - HTTP 5xx, 타임아웃, 네트워크 오류
 * 인증키 오류(30), 일일 한도 초과(22) 등은 재시도해도 소용없으므로 제외한다.
 */
export function isRetryable(err: unknown): boolean {
  if (err instanceof DataGoKrError) {
    return err.code === "99" || /^HTTP_5\d\d$/.test(err.code ?? "");
  }
  if (err instanceof Error) {
    return err.name === "TimeoutError" || err.name === "AbortError" || err.name === "TypeError"; // fetch 네트워크 실패는 TypeError
  }
  return false;
}

export class DataGoKrClient {
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retryDelaysMs: number[];

  constructor(private readonly options: DataGoKrClientOptions) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.baseUrl = options.baseUrl ?? "https://apis.data.go.kr";
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.retryDelaysMs = options.retryDelaysMs ?? [500, 1500];
  }

  async getList<T>(path: string, params: Params = {}): Promise<ListResult<T>> {
    const body = await this.requestWithRetry(path, params);
    return { items: normalizeItems<T>(body?.items), totalCount: Number(body?.totalCount ?? 0) };
  }

  private async requestWithRetry(path: string, params: Params): Promise<any> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.request(path, params);
      } catch (err) {
        const delay = this.retryDelaysMs[attempt];
        if (delay === undefined || !isRetryable(err)) throw err;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  private async request(path: string, params: Params): Promise<any> {
    if (!this.options.serviceKey) {
      throw new DataGoKrError(
        "DATA_GO_KR_SERVICE_KEY 환경변수가 설정되지 않았습니다. data.go.kr에서 발급받은 Decoding 키를 설정하세요.",
        "NO_SERVICE_KEY",
      );
    }

    const url = new URL(path, this.baseUrl);
    // URLSearchParams 가 인코딩하므로 반드시 Decoding 키를 넣어야 이중 인코딩이 안 된다.
    url.searchParams.set("serviceKey", this.options.serviceKey);
    url.searchParams.set("_type", "json");
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }

    const res = await this.fetchImpl(url.toString(), {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();

    if (text.trimStart().startsWith("<")) {
      throw xmlError(text, res.status);
    }
    if (!res.ok) {
      throw new DataGoKrError(`HTTP ${res.status}: ${text.slice(0, 200)}`, `HTTP_${res.status}`);
    }

    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new DataGoKrError(`JSON 파싱 실패: ${text.slice(0, 200)}`, "INVALID_JSON");
    }

    const header = json?.response?.header;
    const code = header?.resultCode != null ? String(header.resultCode) : undefined;
    if (code !== undefined && !SUCCESS_CODES.has(code)) {
      throw new DataGoKrError(`API 오류 [${code}] ${header?.resultMsg ?? ""}`.trim(), code);
    }
    return json?.response?.body;
  }
}

export function normalizeItems<T>(items: unknown): T[] {
  if (!items || typeof items !== "object") return [];
  const item = (items as { item?: T | T[] }).item;
  if (item == null) return [];
  return Array.isArray(item) ? item : [item];
}

function xmlError(xml: string, status: number): DataGoKrError {
  const pick = (tag: string) => xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1]?.trim();
  const code = pick("returnReasonCode") ?? pick("resultCode") ?? `HTTP_${status}`;
  const msg = pick("returnAuthMsg") ?? pick("errMsg") ?? pick("resultMsg") ?? "알 수 없는 오류(XML 응답)";
  return new DataGoKrError(`API 오류 [${code}] ${msg}`, code);
}
