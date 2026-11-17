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

  // 이름이 같은 정류소들을 방향으로 구분해 본다
  for (const s of stops.filter((x: any) => x.name === stops[0].name)) {
    const rs = await call("get_routes_at_stop", { cityCode, nodeId: s.nodeId });
    console.log(`\n[get_routes_at_stop] ${s.name}(${s.stopNo}) → ${rs.length}개 노선`);
    console.log(rs.slice(0, 3).map((r: any) => `${r.routeNo}번: 다음 ${r.nextStop} / ${r.towards} 방면`));
  }

  const near = await call("find_nearby_stops", { lat: stops[0].lat, lng: stops[0].lng, limit: 5 });
  console.log(`\n[find_nearby_stops] ${stops[0].name} 주변`);
  console.log(near.map((n: any) => `${n.name} ${n.distanceM}m (city ${n.cityCode})`));
}

const routeNo = process.argv[4] ?? "106";
const found = await call("search_routes", { cityCode, routeNo });
console.log(`\n[search_routes] ${routeNo} → ${found.length}건`, found.slice(0, 2));
if (found[0]) {
  const info = await call("get_route_info", { cityCode, routeId: found[0].routeId });
  console.log(`\n[get_route_info]`, info);
  const routeStops = await call("get_route_stops", { cityCode, routeId: found[0].routeId });
  console.log(`\n[get_route_stops] ${routeStops.length}개 정류소, 처음 3개:`, routeStops.slice(0, 3));
  const buses = await call("get_bus_locations", { cityCode, routeId: found[0].routeId });
  console.log(`\n[get_bus_locations] 운행 중 ${buses.length}대, 처음 3대:`, buses.slice(0, 3));
}

await client.close();
