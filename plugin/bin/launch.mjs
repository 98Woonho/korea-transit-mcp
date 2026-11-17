#!/usr/bin/env node
/**
 * 플러그인용 MCP 서버 실행기.
 *
 * 왜 .mcp.json 에서 npx 를 바로 부르지 않나:
 *  - Windows 에서는 npx 가 npx.cmd 라서 셸 없이 실행할 수 없다 (MCP 클라이언트는 셸 없이 실행한다).
 *  - 플러그인 버전과 같은 버전의 npm 패키지를 실행하도록 고정해서, 플러그인 Skill 과 서버 도구가 항상 맞물리게 한다.
 * stdio 를 그대로 물려주므로 MCP 통신은 자식 프로세스(실제 서버)와 직접 이루어진다.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";

const manifest = JSON.parse(readFileSync(new URL("../.claude-plugin/plugin.json", import.meta.url), "utf8"));
const version = String(manifest.version ?? "");
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`[korea-transit plugin] plugin.json 의 version 이 올바르지 않습니다: "${version}"`);
  process.exit(1);
}

const pkg = `korea-transit-mcp@${version}`;
// npx 는 현재 폴더(와 상위 폴더)의 package.json 을 프로젝트로 인식한다. 그 프로젝트 이름이 같은 패키지면
// (예: 이 저장소 안에서 실행) 설치하지 않고 로컬 실행 파일을 찾다가 실패한다. 중립적인 임시 폴더에서 실행한다.
const options = { stdio: "inherit", cwd: tmpdir() };
const child =
  process.platform === "win32"
    ? spawn(`npx -y ${pkg}`, { ...options, shell: true }) // 버전은 위에서 형식 검증됨
    : spawn("npx", ["-y", pkg], options);

child.on("error", (err) => {
  console.error(`[korea-transit plugin] npx 실행 실패: ${err.message} (Node.js 20.12 이상과 npm이 필요합니다)`);
  process.exit(1);
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
