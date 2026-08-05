import { describe, expect, it } from "vitest";
import {
  parseDateRange,
  resolveRangeSelection,
} from "../src/services/calculationScope";

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

describe("resolveRangeSelection", () => {
  it("直近 7 日を終了日を含む 7 日間へ変換する", () => {
    expect(
      resolveRangeSelection(
        { type: "relative", count: 7, unit: "day" },
        availableRange,
      ),
    ).toEqual({
      selection: { type: "relative", count: 7, unit: "day" },
      range: { start: "2026-07-27", end: "2026-08-02" },
    });
  });

  it("直近 2 週間を終了日を含む 14 日間へ変換する", () => {
    expect(
      resolveRangeSelection(
        { type: "relative", count: 2, unit: "week" },
        availableRange,
      ).range,
    ).toEqual({ start: "2026-07-20", end: "2026-08-02" });
  });

  it("直近 1 か月を前月の同日からの期間へ変換する", () => {
    expect(
      resolveRangeSelection(
        { type: "relative", count: 1, unit: "month" },
        availableRange,
      ).range,
    ).toEqual({ start: "2026-07-02", end: "2026-08-02" });
  });

  it("月末に存在しない日は対象月の最終日へ合わせる", () => {
    expect(
      resolveRangeSelection(
        { type: "relative", count: 1, unit: "month" },
        { start: "2026-01-01", end: "2026-03-31" },
      ).range,
    ).toEqual({ start: "2026-02-28", end: "2026-03-31" });
  });

  it("取得済み期間より前の開始日を取得済みの先頭日へ合わせる", () => {
    expect(
      resolveRangeSelection(
        { type: "relative", count: 12, unit: "month" },
        availableRange,
      ).range,
    ).toEqual(availableRange);
  });

  it("正の整数ではない期間数を拒否する", () => {
    expect(() =>
      resolveRangeSelection(
        { type: "relative", count: 0, unit: "day" },
        availableRange,
      ),
    ).toThrow();
  });
});
