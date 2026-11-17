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
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const manifest = JSON.parse(readFileSync(new URL("../.claude-plugin/plugin.json", import.meta.url), "utf8"));
const version = String(manifest.version ?? "");
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`[korea-transit plugin] plugin.json 의 version 이 올바르지 않습니다: "${version}"`);
  process.exit(1);
}

// 인증키: 플러그인 설정(userConfig)을 우선 쓰고, 비어 있으면 환경변수 DATA_GO_KR_SERVICE_KEY 를 쓴다.
// userConfig 를 required 로 두면 설정이 없는 환경(CI, `claude plugin eval` 의 격리 환경)에서 서버가 아예 뜨지 않는다.
const pluginKey = (process.env.KOREA_TRANSIT_PLUGIN_KEY ?? "").trim();
const env = { ...process.env };
delete env.KOREA_TRANSIT_PLUGIN_KEY;
if (pluginKey && !pluginKey.startsWith("${")) env.DATA_GO_KR_SERVICE_KEY = pluginKey; // 치환되지 않은 자리표시자는 무시

// 개발 모드: 저장소 안에서 실행되면(plugin/ 의 상위가 이 패키지 루트이고 빌드 결과가 있으면) 로컬 빌드를 바로 실행한다.
//  - `claude plugin eval` 은 매번 빈 환경에서 돌아 npx 가 패키지를 새로 받느라 서버가 늦게 뜬다 → 첫 도구 호출 실패
//  - 릴리스 전 코드(현재 저장소)를 그대로 평가할 수 있다
// 설치된 플러그인(캐시 복사본)의 상위에는 이 패키지가 없으므로 npx 로 배포된 버전을 실행한다.
const repoRoot = new URL("../../", import.meta.url);
const localEntry = new URL("dist/index.js", repoRoot);

const child =
  existsSync(localEntry) && isThisPackage(new URL("package.json", repoRoot))
    ? spawn(process.execPath, [fileURLToPath(localEntry)], { stdio: "inherit", env })
    : spawnPublished(`korea-transit-mcp@${version}`);

child.on("error", (err) => {
  console.error(`[korea-transit plugin] 서버 실행 실패: ${err.message} (Node.js 20.12 이상과 npm이 필요합니다)`);
  process.exit(1);
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));

function spawnPublished(pkg) {
  // npx 는 현재 폴더(와 상위 폴더)의 package.json 을 프로젝트로 인식한다. 그 프로젝트 이름이 같은 패키지면
  // (예: 이 저장소 안에서 실행) 설치하지 않고 로컬 실행 파일을 찾다가 실패한다. 중립적인 임시 폴더에서 실행한다.
  const options = { stdio: "inherit", cwd: tmpdir(), env };
  return process.platform === "win32"
    ? spawn(`npx -y ${pkg}`, { ...options, shell: true }) // 버전은 위에서 형식 검증됨
    : spawn("npx", ["-y", pkg], options);
}

function isThisPackage(pkgUrl) {
  try {
    return JSON.parse(readFileSync(pkgUrl, "utf8")).name === "korea-transit-mcp";
  } catch {
    return false;
  }
}
