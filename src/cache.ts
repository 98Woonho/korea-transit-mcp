/**
 * 아주 단순한 메모리 TTL 캐시.
 * 공공데이터포털 개발계정은 일일 호출 한도가 있으므로, 잘 안 바뀌는 데이터(도시 코드, 정류소 목록)는
 * 캐싱해서 쿼터를 아낀다. 원격 배포(Cloudflare Workers) 시에는 KV 구현으로 교체할 수 있도록
 * 인터페이스를 분리해 둔다.
 */
export interface Cache {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlMs: number): void;
}

export class MemoryCache implements Cache {
  private readonly store = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: this.now() + ttlMs });
  }
}

export async function cached<T>(cache: Cache, key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get<T>(key);
  if (hit !== undefined) return hit;
  const value = await load();
  cache.set(key, value, ttlMs);
  return value;
}

export const TTL = {
  /** 도시 코드: 거의 안 바뀜 */
  cityCodes: 24 * 60 * 60 * 1000,
  /** 정류소 검색 결과 */
  stops: 6 * 60 * 60 * 1000,
  /** 실시간 도착 정보 */
  arrivals: 30 * 1000,
} as const;
