// Skill 평가 실행: `npm run eval -- [claude plugin eval 옵션...]`
//   예) npm run eval -- --case opposite-side-stop
//       npm run eval -- --target ./plugin-noskills   (Skill을 뺀 복사본과 비교할 때)
//
// - 실제 Claude 실행이라 과금된다. 기본값은 케이스당 1회, 비교 실행 없음, 비용 상한 $3.
// - 저장소 안에서 실행되므로 플러그인 실행기가 로컬 dist/ 를 쓴다 (npm run build 를 먼저 수행).
// - 인증키는 서버가 저장소의 .env 에서 읽는다.
// - Claude Code CLI 경로는 환경변수 CLAUDE_BIN 으로 바꿀 수 있다 (기본: PATH 의 claude).
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const tools = JSON.parse(readFileSync(new URL("./eval-tools.json", import.meta.url), "utf8"));
const plugin = JSON.parse(readFileSync(new URL("../plugin/.claude-plugin/plugin.json", import.meta.url), "utf8"));
const prefix = `mcp__plugin_${plugin.name}_korea-transit__`;

const args = process.argv.slice(2);
const targetIdx = args.indexOf("--target");
const target = targetIdx >= 0 ? args.splice(targetIdx, 2)[1] : "./plugin";

const evalArgs = [
  "plugin", "eval", target,
  "--runs", "1",
  "--ablation", "none",
  "--allow-real-servers",
  "--max-cost-usd", "3",
  "--allow-tools", ...tools.map((t) => prefix + t),
  ...args,
];

const bin = process.env.CLAUDE_BIN || "claude";
console.error(`> ${bin} ${evalArgs.slice(0, 3).join(" ")} ... (${tools.length}개 도구 허용, 케이스당 1회, 상한 $3)`);
// Windows 에서 npm 으로 설치한 claude 는 claude.cmd 라 셸이 필요하다. 인자는 모두 고정 문자열이다.
const child = spawn(bin, evalArgs, { stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (err) => {
  console.error(`Claude Code CLI 실행 실패: ${err.message}. CLAUDE_BIN 환경변수로 claude 실행 파일 경로를 지정하세요.`);
  process.exit(1);
});
