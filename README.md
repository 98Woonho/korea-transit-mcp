# korea-transit-mcp

공공데이터포털(data.go.kr)의 대중교통 Open API를 AI 에이전트가 사용할 수 있도록 만든 **MCP(Model Context Protocol) 서버**입니다.
Claude Desktop, Claude Code, Cursor 등 MCP 클라이언트에서 "청주시청 정류장에 다음 버스 언제 와?" 같은 질문에 실제 데이터로 답할 수 있게 합니다.

> 🚧 개발 중 (v0.1.0)

## 제공 도구 (Tools)

| Tool | 설명 | 상태 |
|---|---|---|
| `list_cities` | TAGO 지원 도시와 도시 코드 조회 | ✅ |
| `search_bus_stops` | 정류소명/번호로 정류소 검색 | ✅ |
| `get_bus_arrivals` | 정류소 실시간 도착 예정 정보 | ✅ |
| `get_route_info` | 노선 정보와 경유 정류소 | 🔜 |
| `get_bus_locations` | 노선별 실시간 버스 위치 | 🔜 |

## 설계 원칙: LLM 비용 0원

- 서버는 **LLM을 호출하지 않습니다.** 추론은 사용자의 MCP 클라이언트가 하고, 서버는 결정적인 도구만 제공합니다.
- 잘 바뀌지 않는 데이터(도시 코드, 정류소)는 **TTL 캐시**로 공공 API 일일 호출 한도를 아낍니다.
- 테스트는 가짜 fetch와 인메모리 MCP 트랜스포트로 돌아가서 **CI에서 네트워크와 LLM 비용이 들지 않습니다.**

## 시작하기

### 1. 인증키 발급
1. [공공데이터포털](https://www.data.go.kr) 회원가입
2. "국토교통부_(TAGO)_버스정류소정보" 등 필요한 API에 **활용신청** (대부분 자동승인)
3. 마이페이지 > 개인 API 인증키에서 **Decoding 키**를 복사

### 2. 로컬 실행
```bash
npm install
cp .env.example .env   # DATA_GO_KR_SERVICE_KEY 입력
npm test
npm run inspect        # MCP Inspector로 도구 직접 실행해 보기
```

### 3. Claude Code / Claude Desktop에 연결

**Claude Code (이 저장소에서 개발할 때):** `npm run build` 후 이 폴더를 열면 [.mcp.json](.mcp.json)이 자동으로 인식됩니다. 키는 서버가 `.env`에서 직접 읽습니다.

**Claude Desktop 등 다른 클라이언트:** 설정 파일에 아래처럼 추가합니다.
```json
{
  "mcpServers": {
    "korea-transit": {
      "command": "node",
      "args": ["/절대경로/korea-transit-mcp/dist/index.js"],
      "env": { "DATA_GO_KR_SERVICE_KEY": "발급받은_Decoding_키" }
    }
  }
}
```

## 구조

```
src/
  index.ts              # stdio 엔트리포인트
  server.ts             # MCP 서버와 도구 등록
  cache.ts              # TTL 캐시 (원격 배포 시 KV로 교체 가능)
  datagokr/client.ts    # data.go.kr 공통 클라이언트 (응답 정규화, 오류 처리)
  tago/stations.ts      # TAGO 버스정류소정보 API
test/                   # 가짜 fetch + 인메모리 MCP 클라이언트 테스트
docs/public-apis.md     # 사용 가능한 공공 API 정리
```

## License
MIT
