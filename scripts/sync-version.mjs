// package.json 의 version 을 server.json(레지스트리 메타데이터)에 맞춰 넣는다.
// `npm version <patch|minor|major>` 실행 시 "version" 라이프사이클 스크립트로 자동 호출된다.
import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const serverJson = JSON.parse(readFileSync("server.json", "utf8"));

serverJson.version = pkg.version;
for (const p of serverJson.packages ?? []) {
  if (p.identifier === pkg.name) p.version = pkg.version;
}

writeFileSync("server.json", JSON.stringify(serverJson, null, 2) + "\n");
console.log(`server.json → ${pkg.version}`);
