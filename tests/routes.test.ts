import { describe, expect, it } from "vitest";
import type { RangeSelection } from "../src/services/calculationScope";
import {
  parseAppLocation,
  routeHref,
  sourceHref,
} from "../src/services/routes";

const range = {
  start: "2026-07-01",
  end: "2026-07-31",
};
const absoluteRange = {
  type: "absolute",
  range,
} satisfies RangeSelection;
const relativeRange = {
  type: "relative",
  count: 2,
  unit: "week",
} satisfies RangeSelection;

describe("画面ルート", () => {
  it("PR の URL を項目キーへ変換する", () => {
    expect(
      parseAppLocation(
        "/pulls/VOICEVOX/voicevox/42?start=2026-07-01&end=2026-07-31",
      ),
    ).toEqual({
      route: {
        name: "pull",
        key: "voicevox/voicevox#42",
      },
      rangeSelection: absoluteRange,
    });
  });

  it("人物ページのリンクへ対象期間を含める", () => {
    expect(
      routeHref({ name: "person", login: "Hiroshiba" }, absoluteRange),
    ).toBe(
      "/people/Hiroshiba?start=2026-07-01&end=2026-07-31",
    );
  });

  it("PR 一覧の URL を解釈する", () => {
    expect(
      parseAppLocation(
        "/pulls?start=2026-07-01&end=2026-07-31",
      ),
    ).toEqual({
      route: { name: "pulls" },
      rangeSelection: absoluteRange,
    });
  });

  it("Issue 一覧と計算式のリンクを作る", () => {
    expect(routeHref({ name: "issues" }, absoluteRange)).toBe(
      "/issues?start=2026-07-01&end=2026-07-31",
    );
    expect(routeHref({ name: "methodology" }, absoluteRange)).toBe(
      "/methodology?start=2026-07-01&end=2026-07-31",
    );
  });

  it("直近 N 日、N 週間、N か月の URL を解釈する", () => {
    expect(parseAppLocation("/?period=7d")).toEqual({
      route: { name: "home" },
      rangeSelection: { type: "relative", count: 7, unit: "day" },
    });
    expect(parseAppLocation("/?period=2w")).toEqual({
      route: { name: "home" },
      rangeSelection: relativeRange,
    });
    expect(parseAppLocation("/?period=1m")).toEqual({
      route: { name: "home" },
      rangeSelection: { type: "relative", count: 1, unit: "month" },
    });
  });

  it("直近期間を画面内リンクへ引き継ぐ", () => {
    expect(routeHref({ name: "issues" }, relativeRange)).toBe(
      "/issues?period=2w",
    );
  });

  it("日付指定と直近期間が混在する URL を期間指定なしとして扱う", () => {
    expect(
      parseAppLocation(
        "/?period=2w&start=2026-07-01&end=2026-07-31",
      ),
    ).toEqual({ route: { name: "home" } });
  });

  it("発生源を GitHub ではなく内部詳細ページへリンクする", () => {
    expect(
      sourceHref(
        {
          type: "issue",
          key: "voicevox/voicevox#10",
        },
        absoluteRange,
      ),
    ).toBe(
      "/issues/voicevox/voicevox/10?start=2026-07-01&end=2026-07-31",
    );
  });
});
