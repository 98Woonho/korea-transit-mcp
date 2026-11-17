# korea-transit-mcp

[![CI](https://github.com/98Woonho/korea-transit-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/98Woonho/korea-transit-mcp/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-server-D97757)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

공공데이터포털(data.go.kr)의 전국 버스 Open API를 AI 에이전트가 쓸 수 있게 만든 **MCP(Model Context Protocol) 서버**입니다.
Claude Code, Claude Desktop, Cursor 같은 MCP 클라이언트에서 "시청역에서 106번 언제 와?" 같은 질문에 **실시간 데이터로** 답할 수 있습니다.

<p align="center">
  <img src="docs/demo.svg" alt="Claude Code에서 대전 시청역 106번 버스 도착 정보를 조회하는 데모" width="860">
</p>

## 작동 방식

사용자가 질문하면 LLM(MCP 클라이언트)이 필요한 도구를 스스로 골라 순서대로 호출합니다. 서버는 공공 API를 호출해 정규화된 결과만 돌려주고, **LLM을 직접 호출하지 않습니다.**

```mermaid
sequenceDiagram
    actor U as 사용자
    participant C as MCP 클라이언트<br/>(Claude Code 등)
    participant S as korea-transit-mcp
    participant K as 캐시
    participant A as 공공데이터포털<br/>TAGO API

    U->>C: "시청역에서 비래동 가는 106번 언제 와?"
    C->>S: search_bus_stops(25, "시청역")
    S->>K: 조회
    K-->>S: miss
    S->>A: getSttnNoList
    A-->>S: 시청역 2곳 (길 건너편)
    S-->>C: 관련도 순 정렬된 정류소
    C->>S: get_routes_at_stop(시청역 #32410)
    S->>A: 경유 노선 + 노선별 경유 정류소
    S-->>C: 106번 → 비래동종점 방면 ✓
    C->>S: get_bus_arrivals(#32410, 106번)
    S->>A: 도착 예정 정보 (30초 캐시)
    S-->>C: 4분 후, 3정류장 전
    C-->>U: "시청역(32410)에서 타세요. 약 4분 후 도착"
```

## 제공 도구 (Tools)

국토교통부 TAGO 버스 API 4종(정류소·도착·노선·위치)을 감싼 조회 도구 9개와, 여러 API를 조합해 계산하는 분석 도구 3개입니다. 서울은 TAGO에 포함되지 않습니다.

| 분류 | Tool | 설명 |
|---|---|---|
| 정류소 | `list_cities` | 지원 도시와 도시 코드 조회 (전국 138개) |
| | `search_bus_stops` | 정류소명/번호 검색, 관련도 순 정렬 |
| | `find_nearby_stops` | 좌표 주변 정류소, 가까운 순 + 거리(m) |
| | `get_routes_at_stop` | 정류소 경유 노선 + **다음 정류소·방면** (같은 이름의 길 건너편 정류소 구분) |
| 도착 | `get_bus_arrivals` | 실시간 도착 예정 (분, 남은 정류장 수, 곧 도착) |
| 노선 | `search_routes` | 노선 번호 검색, 첫차·막차 |
| | `get_route_info` | 기점·종점, 배차간격 (평일/토/일) |
| | `get_route_stops` | 노선 경유 정류소 순서와 방향 |
| 위치 | `get_bus_locations` | 운행 중인 버스의 현재 정류소와 향하는 종점 |
| 분석 | `find_direct_routes` | 출발·도착 사이 **직통 노선**. 같은 이름 후보를 모두 받아 어느 쪽에서 타야 하는지까지 판별 |
| | `find_transfer_routes` | 직통이 없을 때 **1회 환승 경로**. 두 노선의 경유 순서·방향을 대조해 실제로 이어지는 경로만, 같은 정류소 또는 걸어서(기본 200m 이내) 갈아타기 |
| | `analyze_headway` | 운행 중인 버스의 **앞뒤 차 간격**: 정류장 수, 균등 배치 대비 비율, 추정 분 |

분석 도구는 LLM이 여러 번 호출해 직접 맞춰 볼 일을 **서버에서 한 번에 결정적으로 계산**합니다. 결과가 정확하고 테스트할 수 있으며, 클라이언트 토큰도 아낍니다.
몰림·공백 같은 **판단 기준은 도구가 아니라 Skill**이 정합니다.

### 예시: 이름이 같은 정류소 구분
"시청역"으로 검색하면 길 건너편 정류소 두 곳이 나옵니다. 공공 API의 "정류소 경유 노선"에는 방향 정보가 없지만,
이 서버는 노선별 경유 정류소 순서와 방향 코드(`updowncd`)를 합쳐서 방면을 계산합니다.

```
시청역(32410)  617번: 다음 목련아파트 / 비래동종점 방면
시청역(32390)  617번: 다음 시청.교육청 / 가장제일장로교회 방면
```

## 품질 검증

세 층으로 검증합니다. 위의 두 층은 비용이 0원이고, Skill 평가만 LLM 비용이 들어 필요할 때 직접 실행합니다.

| 층 | 무엇을 | 어떻게 | 비용 |
|---|---|---|---|
| 단위·프로토콜 테스트 | 응답 정규화, 판정 계산, 설정 일관성, MCP 도구 호출 | `npm test` (가짜 fetch + 인메모리 MCP 클라이언트), push마다 CI | 0원 |
| 실제 API 점검 | 12개 도구가 실데이터에서 동작하는지 | `npm run smoke` | 0원 (공공 API 호출 수십 건) |
| **Skill 평가** | Claude가 Skill대로 판단·답변하는지 | `npm run eval` ([`claude plugin eval`](plugin/evals/)) | 약 $1 / 1회 |

### Skill 평가 결과 (2026-11-17, 케이스당 1회, 실시간 데이터)

같은 MCP 도구를 둔 채 **Skill만 넣고 뺀** 두 조건으로 6개 케이스(검사 항목 23개)를 돌렸습니다. 답변 모델은 **Claude Opus 5.5**, 채점은 LLM 심사위원(**Claude Haiku**, 투표 3회)이 실행 기록을 보고 합니다.

| 케이스 | 검사 | Skill 있음 | Skill 없음 |
|---|---|---|---|
| 반대편 정류장 구분 (시청역 → 목련아파트) | 후보 전체 전달, 32410 탑승 안내, 반대편 주의, 노선 지어내지 않기 | 5/5 | 5/5 |
| 직통 노선 없음 (목원대 → 신탄진역) | 직통 없음 안내, 검증 안 된 환승 경로 제시 금지, 대안 제시 | 4/4 | 4/4 ※ |
| 도시 미지정 | 도시를 묻거나 가정을 밝히기 | 1/1 | 1/1 |
| **106번 운행 리포트** | 판정 기준 적용, 회차·기점 구간 제외, 등급, 형식 | 7/7 | **2/7** |
| 사용자 기준 우선 ("2배부터 공백") | 사용자 기준 적용·명시 | 2/2 | 2/2 |
| 승객 도착 문의 | 운행 리포트로 오발동하지 않기 | 2/2 | 2/2 |
| **합계** | | **23/23 (100%)** | **16/23 (70%)** ※ |

※ 채점 결과를 사람이 다시 확인해 고친 값입니다. 아래 "채점 검증" 참고.

**알게 된 것**
- **Skill이 결정적인 곳은 "판단"입니다.** Skill 없이도 `analyze_headway`는 호출했지만, 기점 통과 구간(×1.67)을 🔴 공백으로 판정했고, 정상 범위(×1.48 ≤ 1.5)인 구간도 공백으로 올렸으며, 노선 전체 등급을 내지 않았습니다. 판단 기준을 Skill로 분리한 설계가 효과가 있었습니다.
- **정류장 구분은 Skill이 없어도 통과했습니다.** 후보를 모두 받아 서버가 판별하는 `find_direct_routes`의 **도구 설계**가 이미 그 일을 하고 있기 때문입니다. 계산은 도구에, 판단은 Skill에 둔다는 원칙이 결과에서도 드러났습니다.
- **Skill이 오히려 지나치게 보수적인 곳도 찾았습니다.** 직통 노선이 없을 때 Skill은 "환승 경로는 검증할 수 없다"며 지도 앱을 권했습니다. 반면 Skill 없는 실행은 `get_route_stops`로 두 노선의 정류장 순서와 방향을 직접 확인해 "106번 → 대전광역시청 → 703번" 환승 경로를 정확히 제시했습니다. 기존 도구로도 환승을 검증할 수 있다는 뜻이라, 이 계산을 서버의 결정적 도구 `find_transfer_routes`로 옮기고 Skill이 그 결과만 안내하도록 고쳤습니다(v0.4.0). 위 표는 그 이전 결과입니다.

**채점 검증:** 채점은 Claude Haiku(투표 3회)가 하므로, 46개 판정(23개 항목 × 2조건)을 실행 기록과 직접 대조했습니다. 운행 리포트는 도구 결과에서 판정 기준대로 등급을 다시 계산해 비교했습니다. 45개는 맞았고 1개가 틀렸습니다. Skill 없는 실행의 환승 경로를 "검증 안 된 경로"로 불합격 처리한 판정인데, 실제로는 도구 결과로 검증된 경로였습니다. 원인은 Haiku가 아니라 채점 기준 문장이었습니다. "어떤 도구도 환승 경로를 검증하지 않았으므로"라는 잘못된 전제를 기준에 넣어 두었고, Haiku는 그 전제를 그대로 따랐습니다. 지금은 "환승 경로를 제시했다면 각 구간이 도구 결과로 뒷받침되는가"로 기준을 고쳤습니다.

### v0.4.0: 환승 도구 추가 후 (2026-11-17, 직통 노선 없음 케이스, Skill 있음)

| 검사 | 채점 방식 | 결과 |
|---|---|---|
| 목원대·신탄진역 후보로 `find_direct_routes` 호출 | 결정적 (`tool_used` + 인자 정규식) | ✅ |
| 직통 노선이 없다고 안내 | LLM (최종 답변) | ✅ |
| 직통 탐색 **다음에** 환승 탐색 | 결정적 (`tool_order`) | ✅ |
| 같은 후보로 `find_transfer_routes` 호출 | 결정적 (`tool_used` + 인자 정규식) | ✅ |
| 두 버스 번호, 탈 곳, 환승 정류장 번호를 담은 환승 경로 안내 | LLM (최종 답변) | ✅ |

**5/5, 비용 $0.20.** 답변("106번 → 복합터미널(12010)에서 같은 정류장 환승 → 급행 2번, 39정류장")은 같은 시각 실제 API로 돌린 `npm run smoke` 결과와 일치했습니다.

**채점 방식을 바꾼 이유:** 첫 시도에서 "환승 경로가 도구 결과로 뒷받침되는가" 항목이 실패했는데, 답변은 맞았습니다. 확인해 보니 `claude plugin eval`은 LLM 채점관에게 실행 기록의 **앞 12개와 뒤 12개 메시지만** 넘기고 가운데를 생략합니다(`[…N messages elided…]`). 그 실행에서는 핵심인 도구 호출 두 개가 생략된 구간에 있었습니다. 그래서 "어떤 도구를 어떤 인자로, 어떤 순서로 불렀나"는 생략과 상관없는 **결정적 채점기**로 바꾸고, LLM 채점은 항상 보이는 **최종 답변**만 보게 했습니다. 경로가 실제로 이어지는지는 도구가 계산으로 보장하고 단위 테스트로 검사합니다.

**한계**
- 케이스당 1회 실행이라 표본이 작습니다.
- 실시간 데이터라 두 조건이 같은 상황을 본 것은 아닙니다(약 6분 차이). Skill 있는 실행 때는 106번이 모두 정상 간격이라 "몰림·공백 판정이 기준과 맞는가", "사용자 기준 2배 적용" 항목이 실질적인 시험이 되지 못했습니다. Skill이 실제 몰림·공백을 기준대로 판정하는지는 이상 구간이 있는 데이터로 다시 확인해야 합니다.
- "판정 기준 파일을 읽었다", "리포트 5개 절" 같은 항목은 Skill이 정의한 형식이라, Skill이 없으면 실패하는 것이 당연합니다.
- 위 표의 비교 실행 12개 중 8개에서도 실행 기록 가운데 1~20개 메시지가 생략돼 있었습니다. 저장된 기록도 같은 방식으로 잘려 있어서, 생략 구간에 있던 도구 호출은 채점관도 사람의 재검증도 직접 확인하지 못했습니다. 예를 들어 Skill 있는 직통 노선 없음 실행의 "`find_direct_routes` 호출" 통과 판정이 그렇습니다. 다른 케이스에 남은 "○○ 도구를 호출했다" 류의 LLM 채점 항목도 결정적 채점기로 바꿀 대상입니다.

### 다시 평가하기
```bash
npm run eval                            # 전체 6개 케이스, 케이스당 1회, 비용 상한 $3
npm run eval -- --case no-direct-route  # 한 케이스만
npm run eval -- --model sonnet          # 답변 모델 지정 (기본: 현재 Claude Code 설정 모델)
```
Claude Code CLI(`claude`)가 필요합니다. 저장소 안에서 실행하면 플러그인이 **로컬 빌드**를 쓰므로 릴리스 전 변경을 평가할 수 있고, 인증키는 `.env`에서 읽습니다.

## 설계 원칙: LLM 비용 0원

- 서버는 **LLM을 호출하지 않습니다.** 추론은 사용자의 MCP 클라이언트가 하고, 서버는 결정적인 도구만 제공합니다.
- 잘 바뀌지 않는 데이터(도시 코드, 정류소)는 **TTL 캐시**로 공공 API 일일 호출 한도를 아낍니다.
- 테스트는 가짜 fetch와 인메모리 MCP 트랜스포트로 돌아가서 **CI에서 네트워크와 LLM 비용이 들지 않습니다.**

## 시작하기

### 1. 인증키 발급
1. [공공데이터포털](https://www.data.go.kr) 회원가입
2. "국토교통부_(TAGO)_버스정류소정보" 등 필요한 API에 **활용신청** (대부분 자동승인)
3. 마이페이지 > 개인 API 인증키에서 **Decoding 키**를 복사

### 2-A. Claude Code 플러그인으로 설치 (추천: MCP 서버 + Skill 한 번에)

```
/plugin install korea-transit --marketplace 98Woonho/korea-transit-mcp
```

플러그인을 켤 때 **인증키 입력 창**이 뜹니다. 키는 OS 보안 저장소에 보관되고 설정 파일에는 남지 않습니다.
설치하면 MCP 도구 12개와 함께 아래 Skill이 들어옵니다.

| Skill | 이렇게 물어보세요 | 하는 일 |
|---|---|---|
| `korea-transit:bus-trip` | "대전 시청역에서 목련아파트까지 버스 뭐 타?" | 길 건너편 정류장까지 구분해 탈 곳, 노선, 실시간 도착을 안내. 직통이 없으면 검증된 1회 환승 경로 |
| `korea-transit:route-ops-report` | "대전 106번 운행 상태 분석해줘" | 배차간격 대비 몰림·공백 구간을 판정한 운행관리 리포트 |

### 2-B. MCP 서버만 연결 (다른 클라이언트, `npx`로 실행)

**Claude Code**
```bash
claude mcp add korea-transit -e DATA_GO_KR_SERVICE_KEY=발급받은_Decoding_키 -- npx -y korea-transit-mcp
```

**Claude Desktop / Cursor 등** 설정 파일의 `mcpServers`에 추가:
```json
{
  "mcpServers": {
    "korea-transit": {
      "command": "npx",
      "args": ["-y", "korea-transit-mcp"],
      "env": { "DATA_GO_KR_SERVICE_KEY": "발급받은_Decoding_키" }
    }
  }
}
```

Node.js 20.12 이상이 필요합니다.

## 개발

```bash
npm install
cp .env.example .env   # DATA_GO_KR_SERVICE_KEY 입력
npm test               # 네트워크·LLM 없이 도는 테스트
npm run smoke          # 실제 API로 전체 도구 점검
npm run inspect        # MCP Inspector로 도구 직접 실행
```

이 저장소를 Claude Code로 열면 [.mcp.json](.mcp.json)으로 로컬 빌드(`dist/`)가 자동 연결되고, 키는 서버가 `.env`에서 직접 읽습니다.

릴리스는 `npm version` 후 태그를 push하면 GitHub Actions가 npm 배포(Trusted Publishing)와 MCP 레지스트리 갱신까지 자동으로 합니다. 자세한 내용은 [docs/RELEASING.md](docs/RELEASING.md)를 참고하세요.

## 구조

```
src/
  index.ts              # stdio 엔트리포인트
  server.ts             # 의존성 조립
  cache.ts              # TTL 캐시 (원격 배포 시 KV로 교체 가능)
  datagokr/client.ts    # data.go.kr 공통 클라이언트 (응답 정규화, 오류 처리)
  tago/                 # TAGO API 어댑터: 원본 필드 → 정규화된 도메인 객체
    stations.ts         #   정류소 (검색, 주변, 경유 노선)
    arrivals.ts         #   도착 정보
    routes.ts           #   노선, 경유 정류소, 버스 위치, 방향 계산
  analysis/             # 순수 계산 로직 (직통 노선 판별, 운행 간격 분석) — API 호출 없음
  tools/                # MCP 도구 정의 (설명, 입력 스키마, 응답 가공)
plugin/                 # Claude Code 플러그인 (마켓플레이스: .claude-plugin/marketplace.json)
  .claude-plugin/plugin.json  # 매니페스트, 인증키 입력(userConfig)
  .mcp.json             #   npm 패키지를 실행하는 MCP 설정
  bin/launch.mjs        #   플러그인 버전과 같은 npm 버전을 실행 (Windows 호환)
  skills/               #   bus-trip, route-ops-report
scripts/smoke.ts        # 실제 API로 전체 도구 점검
test/                   # 가짜 fetch + 인메모리 MCP 클라이언트 테스트
docs/public-apis.md     # 사용 가능한 공공 API 정리
```

### 캐시 정책 (공공 API 일일 한도 보호)
| 데이터 | TTL |
|---|---|
| 도시 코드 | 24시간 |
| 정류소, 노선, 경유 정류소/노선 | 6시간 |
| 도착 정보 | 30초 |
| 버스 위치 | 15초 |

## License
MIT
