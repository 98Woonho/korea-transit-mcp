# 사용 가능한 공공 교통 API 정리

> 2026-11-17 조사. data.go.kr 상세 페이지와 엔드포인트 응답(401/400)으로 존재 여부를 확인했고, 실제 데이터 응답은 아직 키로 검증하지 않았습니다.
> **미확인** 항목은 키 발급 후 직접 확인이 필요합니다.

## 한눈에 보기

| 범위 | 제공 | Base URL | 포맷 | 개발계정 한도 | 우선순위 |
|---|---|---|---|---|---|
| 전국(TAGO) | 국토교통부 | `https://apis.data.go.kr/1613000/` | JSON(`_type=json`) | 10,000건/일 | ⭐ 1단계 |
| 경기도 | 경기도 | `https://apis.data.go.kr/6410000/` | JSON(`format=json` **필수**) | 1,000건/일 | 2단계 |
| 서울 | 서울시 | `http://ws.bus.go.kr/api/rest/` (**HTTP만**) | XML 기본 | 1,000건/일 | 3단계 |

모두 **자동승인**이며, data.go.kr 인증키 하나로 사용하되 **데이터셋마다 활용신청**이 필요합니다.

## 1. 국토교통부 TAGO (1단계 구현 대상)

| 서비스 | 활용신청 | 주요 오퍼레이션 → 필수 파라미터 | 매핑할 MCP Tool |
|---|---|---|---|
| 버스정류소정보 `BusSttnInfoInqireService` | [15098534](https://www.data.go.kr/data/15098534/openapi.do) | `getCtyCodeList`<br>`getSttnNoList` → cityCode (+nodeNm/nodeNo)<br>`getCrdntPrxmtSttnList` → gpsLati, gpsLong<br>`getSttnThrghRouteList` → cityCode, **nodeid**(소문자) | `list_cities` ✅<br>`search_bus_stops` ✅<br>`find_nearby_stops`<br>`get_routes_at_stop` |
| 버스도착정보 `ArvlInfoInqireService` | [15098530](https://www.data.go.kr/data/15098530/openapi.do) | `getSttnAcctoArvlPrearngeInfoList` → cityCode, nodeId<br>`getSttnAcctoSpcifyRouteBusArvlPrearngeInfoList` → +routeId | `get_bus_arrivals` |
| 버스노선정보 `BusRouteInfoInqireService` | [15098529](https://www.data.go.kr/data/15098529/openapi.do) | `getRouteNoList` → cityCode, routeNo<br>`getRouteInfoIem` → cityCode, routeId<br>`getRouteAcctoThrghSttnList` → cityCode, routeId | `search_routes`<br>`get_route_info` |
| 버스위치정보 `BusLcInfoInqireService` | [15098533](https://www.data.go.kr/data/15098533/openapi.do) | `getRouteAcctoBusLcList` → cityCode, routeId<br>`getRouteAcctoSpcifySttnAccesBusLcInfo` → +nodeId | `get_bus_locations` |

- ✅ 2026-11-17 실제 호출로 확인: 지원 도시는 **138개**이고 **서울은 포함되지 않습니다.** 세종(12), 부산(21), 대구(22), 인천(23), 광주(24), 대전(25) 등이 있습니다.
- ✅ 도착정보 실제 응답 필드: `arrprevstationcnt`(몇 정류장 전), `arrtime`(초), `nodeid`, `nodenm`, `routeid`, `routeno`(숫자), `routetp`(간선버스 등), `vehicletp`(저상버스, 일반차량)
- 정류소 검색(`getSttnNoList`) 응답에는 `citycode` 필드가 없었습니다.
- 창원시는 자체 API를 2027-01-01에 종료하고 TAGO로 옮겨가라고 공지했습니다. 지방 도시는 TAGO로 수렴하는 추세라 1단계 대상으로 적합합니다.

## 2. 경기도 v2

| 서비스 | 활용신청 | 경로 / 오퍼레이션 |
|---|---|---|
| 정류소 조회 | [15080666](https://www.data.go.kr/data/15080666/openapi.do) | `busstationservice/v2`: `getBusStationListv2`(keyword), `getBusStationAroundListv2`(x, y), `getBusStationViaRouteListv2`(stationId), `busStationInfov2`(stationId) |
| 버스도착정보 | [15080346](https://www.data.go.kr/data/15080346/openapi.do) | `busarrivalservice/v2`: `getBusArrivalListv2`(stationId), `getBusArrivalItemv2`(stationId, routeId, staOrder) |
| 버스노선 | [15080662](https://www.data.go.kr/data/15080662/openapi.do) | `busrouteservice/v2`: `getBusRouteListv2`(keyword), `getBusRouteInfoItemv2`, `getBusRouteStationListv2`, `getBusRouteLineListv2`(routeId) |
| 버스위치정보 | **미확인** | `buslocationservice/v2/getBusLocationListv2` (routeId로 추정) |

주의: 경기도는 `_type`이 아니라 **`format=json`**을 쓰므로, `DataGoKrClient`에서 포맷 파라미터 이름을 설정할 수 있게 확장해야 합니다.

## 3. 서울 (ws.bus.go.kr)

| 서비스 | 활용신청 | 주요 오퍼레이션 |
|---|---|---|
| 정류소정보 | [15000303](https://www.data.go.kr/data/15000303/openapi.do) | `stationinfo/getStationByName`(stSrch), `getStationByUid`(arsId: **정류소 기준 도착정보는 여기**), `getRouteByStation`, `getStationByPos`(tmX, tmY, radius) |
| 버스도착정보 | [15000314](https://www.data.go.kr/data/15000314/openapi.do) | `arrive/getArrInfoByRouteAll`(busRouteId), `getArrInfoByRoute`(stId, busRouteId, ord) |
| 노선정보 | [15000193](https://www.data.go.kr/data/15000193/openapi.do) | `busRouteInfo/getBusRouteList`(strSrch, 미확인), `getRouteInfo`, `getStaionByRoute`(원문 오타 그대로) |
| 버스위치정보 | [15000332](https://www.data.go.kr/data/15000332/openapi.do) | `buspos/getBusPosByRtid`(busRouteId), `getBusPosByVehId`(vehId) |

- **HTTPS를 지원하지 않습니다.** 443 포트는 타임아웃이 났습니다. Cloudflare Workers에서 HTTP 호출이 되는지 따로 확인이 필요합니다.
- `resultType=json` 지원 여부는 **미확인**입니다. XML 파서(`fast-xml-parser`)를 대비해 두세요.
- 좌표가 WGS84가 아니라 TM 좌표(tmX/tmY)인 API가 있어 변환이 필요할 수 있습니다.

## 4. 기타 확장 후보

- TAGO 고속버스정보 [15098522](https://www.data.go.kr/data/15098522/openapi.do), 시외버스정보 [15098541](https://www.data.go.kr/data/15098541/openapi.do): 버스업계 도메인과 잘 맞습니다. 오퍼레이션은 미확인입니다.
- 서울 지하철 실시간 도착 ([OA-12764](https://data.seoul.go.kr/dataList/OA-12764/F/1/datasetView.do)): data.go.kr 키가 아니라 서울열린데이터광장에서 키를 따로 발급받아야 합니다. HTTP 전용입니다.
- 인천 버스: 정류소 15056529, 버스위치 15059206

## 5. 설계 메모

- **지역별 어댑터 분리:** ID 체계가 서로 다릅니다(TAGO `nodeId/routeId`, 서울 `arsId/stId/busRouteId`, 경기 `stationId/routeId`). `src/tago`, `src/gyeonggi`, `src/seoul`처럼 어댑터를 나누고, MCP 도구는 공통 출력 형식을 씁니다.
- **쿼터와 캐시 정책:** 도시 코드는 24시간, 정류소와 노선은 6시간, 도착과 위치는 30초 동안 캐싱합니다(`src/cache.ts`).
- **인증키:** URLSearchParams가 직접 인코딩하므로 **Decoding 키**를 사용해야 합니다.
