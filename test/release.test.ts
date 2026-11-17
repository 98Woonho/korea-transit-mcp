/**
 * 배포 메타데이터 일관성 검사.
 * MCP 레지스트리는 package.json 의 mcpName 과 server.json 의 name 이 같아야 하고,
 * 버전을 올릴 때 세 군데(package.json, server.json, SERVER_INFO) 중 하나를 빠뜨리기 쉽다.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SERVER_INFO } from "../src/server.js";

const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const pkg = readJson("../package.json");
const serverJson = readJson("../server.json");

describe("배포 메타데이터", () => {
  it("버전이 package.json, server.json, SERVER_INFO 모두 같다", () => {
    expect(serverJson.version).toBe(pkg.version);
    expect(serverJson.packages[0].version).toBe(pkg.version);
    expect(SERVER_INFO.version).toBe(pkg.version);
  });

  it("레지스트리 이름이 mcpName과 같고, npm 패키지 이름이 identifier와 같다", () => {
    expect(serverJson.name).toBe(pkg.mcpName);
    expect(serverJson.packages[0].identifier).toBe(pkg.name);
    expect(SERVER_INFO.name).toBe(pkg.name);
  });

  it("레지스트리 description은 100자 이하", () => {
    expect(serverJson.description.length).toBeLessThanOrEqual(100);
  });
});
