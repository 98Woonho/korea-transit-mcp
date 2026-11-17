#!/usr/bin/env node
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DataGoKrClient } from "./datagokr/client.js";
import { createServer } from "./server.js";

/**
 * 로컬 개발 편의: 환경변수로 키가 안 들어왔으면 패키지 루트의 .env 를 읽는다.
 * (MCP 클라이언트 설정 파일에 키를 복사해 둘 필요가 없게 하기 위함)
 */
function loadLocalEnv() {
  if (process.env.DATA_GO_KR_SERVICE_KEY) return;
  const envPath = fileURLToPath(new URL("../.env", import.meta.url));
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

// stdio 서버에서 stdout은 MCP 프로토콜 전용이다. 로그는 반드시 stderr(console.error)로.
async function main() {
  loadLocalEnv();
  const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY;
  if (!serviceKey) {
    console.error("[korea-transit-mcp] 경고: DATA_GO_KR_SERVICE_KEY가 없습니다. 도구 호출 시 오류가 반환됩니다.");
  }

  const server = createServer({ client: new DataGoKrClient({ serviceKey }) });
  await server.connect(new StdioServerTransport());
  console.error("[korea-transit-mcp] stdio 서버 시작");
}

main().catch((err) => {
  console.error("[korea-transit-mcp] 치명적 오류:", err);
  process.exit(1);
});
