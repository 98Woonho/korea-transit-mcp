/**
 * 실제 data.go.kr API로 도구를 호출해 보는 스모크 테스트. (CI에서는 돌리지 않음)
 * 사용: .env 에 DATA_GO_KR_SERVICE_KEY 설정 후 `npm run smoke`
 * 호출 수: 약 3건 (일일 한도 10,000건)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DataGoKrClient } from "../src/datagokr/client.js";
import { createServer } from "../src/server.js";

const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY;
if (!serviceKey) {
  console.error(".env 에 DATA_GO_KR_SERVICE_KEY 를 설정하세요.");
  process.exit(1);
}

const api = new DataGoKrClient({ serviceKey });
const server = createServer({ client: api });
const client = new Client({ name: "smoke", version: "0.0.0" });
const [c, s] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(s), client.connect(c)]);

async function call(name: string, args: Record<string, unknown>) {
  const res: any = await client.callTool({ name, arguments: args });
  const text: string = res.content[0].text;
  if (res.isError) throw new Error(`${name} 실패: ${text}`);
  return JSON.parse(text);
}

const cities = await call("list_cities", {});
console.log(`\n[list_cities] ${cities.length}개 도시`);
console.log("  서울 포함 여부:", cities.some((x: any) => x.cityName.includes("서울")));
console.log("  예시:", cities.slice(0, 5));

const cityCode = Number(process.argv[2] ?? 25); // 기본 25 = 대전
const keyword = process.argv[3] ?? "시청";
const stops = await call("search_bus_stops", { cityCode, name: keyword, limit: 5 });
console.log(`\n[search_bus_stops] cityCode=${cityCode} name=${keyword} → ${stops.length}건`);
console.log(stops);

if (stops[0]) {
  const arrivals = await call("get_bus_arrivals", { cityCode, nodeId: stops[0].nodeId });
  console.log(`\n[get_bus_arrivals] ${stops[0].name} → ${arrivals.length}건`);
  console.log(arrivals.slice(0, 5));
}

await client.close();
