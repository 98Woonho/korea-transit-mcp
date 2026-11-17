import { describe, expect, it } from "vitest";
import { rankByName } from "../src/tago/stations.js";

const names = (xs: { name: string }[]) => xs.map((x) => x.name);
const stops = (...ns: string[]) => ns.map((name) => ({ name }));

describe("rankByName", () => {
  it("완전 일치 → 앞부분 일치 → 포함 순", () => {
    const ranked = rankByName(stops("대전광역시청", "시청역", "시청"), "시청");
    expect(names(ranked)).toEqual(["시청", "시청역", "대전광역시청"]);
  });

  it("같은 등급이면 이름이 짧은 것이 먼저", () => {
    const ranked = rankByName(stops("대전광역시청", "계룡시청"), "시청");
    expect(names(ranked)).toEqual(["계룡시청", "대전광역시청"]);
  });

  it("공백과 구분 기호는 무시한다", () => {
    const ranked = rankByName(stops("시청역", "시청.교육청"), "시청 교육청");
    expect(names(ranked)[0]).toBe("시청.교육청");
  });

  it("같은 점수면 원래 순서를 유지한다 (같은 이름의 양방향 정류소)", () => {
    const input = [
      { name: "시청환승지", id: "A" },
      { name: "시청환승지", id: "B" },
    ];
    expect(rankByName(input, "시청").map((x) => x.id)).toEqual(["A", "B"]);
  });
});
