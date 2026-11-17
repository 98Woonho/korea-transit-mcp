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
const pluginJson = readJson("../plugin/.claude-plugin/plugin.json");
const pluginMcp = readJson("../plugin/.mcp.json");
const marketplace = readJson("../.claude-plugin/marketplace.json");

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

describe("Claude Code 플러그인", () => {
  it("플러그인 버전 = npm 버전 (실행기가 이 버전의 npm 패키지를 실행)", () => {
    expect(pluginJson.version).toBe(pkg.version);
  });

  it("마켓플레이스 항목이 plugin/ 을 가리키고 이름이 plugin.json과 같다", () => {
    const entry = marketplace.plugins.find((p: any) => p.name === pluginJson.name);
    expect(entry?.source).toBe("./plugin");
  });

  it("MCP 설정이 userConfig 인증키를 실행기로 넘기고, 키는 선택 항목이다", () => {
    const server = pluginMcp.mcpServers["korea-transit"];
    const keys = Object.keys(pluginJson.userConfig);
    // 실행기가 이 값을 우선 쓰고, 비어 있으면 환경변수 DATA_GO_KR_SERVICE_KEY 로 대체한다
    expect(server.env.KOREA_TRANSIT_PLUGIN_KEY).toBe(`\${user_config.${keys[0]}}`);
    // DATA_GO_KR_SERVICE_KEY 를 여기서 덮어쓰면 환경변수 대체가 불가능해진다
    expect(server.env.DATA_GO_KR_SERVICE_KEY).toBeUndefined();
    expect(pluginJson.userConfig[keys[0]].sensitive).toBe(true);
    // required 면 설정이 없는 환경(CI, plugin eval)에서 서버가 뜨지 않는다 (2026-11-17 eval에서 확인)
    expect(pluginJson.userConfig[keys[0]].required).toBe(false);
  });

  it("Skill마다 SKILL.md가 있고 frontmatter name이 폴더명과 같다", () => {
    for (const name of ["bus-trip", "route-ops-report"]) {
      const md = readFileSync(new URL(`../plugin/skills/${name}/SKILL.md`, import.meta.url), "utf8");
      expect(md.match(/^name: (.+)$/m)?.[1]).toBe(name);
    }
  });
});
