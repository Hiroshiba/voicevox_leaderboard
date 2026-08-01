import { describe, expect, it } from "vitest";
import { parseDateRange } from "../src/services/calculationScope";

const availableRange = {
  start: "2026-05-02",
  end: "2026-08-02",
};

describe("parseDateRange", () => {
  it("取得済み期間内の日付範囲を受け入れる", () => {
    expect(
      parseDateRange(
        {
          start: "2026-07-01",
          end: "2026-07-31",
        },
        availableRange,
      ),
    ).toEqual({
      start: "2026-07-01",
      end: "2026-07-31",
    });
  });

  it("暦に存在しない日付を拒否する", () => {
    expect(() =>
      parseDateRange(
        {
          start: "2026-02-30",
          end: "2026-03-01",
        },
        availableRange,
      ),
    ).toThrow("実在する日付を指定してください。");
  });

  it("取得済み期間外の日付を拒否する", () => {
    expect(() =>
      parseDateRange(
        {
          start: "2026-05-01",
          end: "2026-07-31",
        },
        availableRange,
      ),
    ).toThrow("対象期間は取得済み");
  });
});
