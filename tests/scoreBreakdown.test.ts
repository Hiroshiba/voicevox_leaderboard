import { describe, expect, it } from "vitest";
import { calculateScoreBarPercentage } from "../src/services/scoreBreakdown";

describe("calculateScoreBarPercentage", () => {
  it("最大点のバーを全幅で表示する", () => {
    expect(calculateScoreBarPercentage(12, 12)).toBe(100);
  });

  it("最大点より小さいバーを相対的に短く表示する", () => {
    expect(calculateScoreBarPercentage(3, 12)).toBe(25);
  });

  it("合計点が最大点を超える場合は例外を投げる", () => {
    expect(() => calculateScoreBarPercentage(13, 12)).toThrow(
      "点数内訳の合計がバーの最大値を超えています。",
    );
  });
});
