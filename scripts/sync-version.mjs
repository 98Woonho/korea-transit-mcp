// package.json 의 version 을 server.json(MCP 레지스트리)과 plugin.json(Claude Code 플러그인)에 맞춰 넣는다.
// `npm version <patch|minor|major>` 실행 시 "version" 라이프사이클 스크립트로 자동 호출된다.
import { readFileSync, writeFileSync } from "node:fs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + "\n");

const pkg = readJson("package.json");

const serverJson = readJson("server.json");
serverJson.version = pkg.version;
for (const p of serverJson.packages ?? []) {
  if (p.identifier === pkg.name) p.version = pkg.version;
}
writeJson("server.json", serverJson);

// 플러그인 실행기(plugin/bin/launch.mjs)가 이 버전의 npm 패키지를 실행한다
const pluginJsonPath = "plugin/.claude-plugin/plugin.json";
const pluginJson = readJson(pluginJsonPath);
pluginJson.version = pkg.version;
writeJson(pluginJsonPath, pluginJson);

console.log(`server.json, plugin.json → ${pkg.version}`);
