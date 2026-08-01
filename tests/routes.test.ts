import { describe, expect, it } from "vitest";
import {
  parseAppLocation,
  routeHref,
  sourceHref,
} from "../src/services/routes";

const range = {
  start: "2026-07-01",
  end: "2026-07-31",
};

describe("画面ルート", () => {
  it("PR のハッシュ URL を項目キーへ変換する", () => {
    expect(
      parseAppLocation(
        "#/pulls/VOICEVOX/voicevox/42?start=2026-07-01&end=2026-07-31",
      ),
    ).toEqual({
      route: {
        name: "pull",
        key: "voicevox/voicevox#42",
      },
      range,
    });
  });

  it("人物ページのリンクへ対象期間を含める", () => {
    expect(routeHref({ name: "person", login: "Hiroshiba" }, range)).toBe(
      "#/people/Hiroshiba?start=2026-07-01&end=2026-07-31",
    );
  });

  it("発生源を GitHub ではなく内部詳細ページへリンクする", () => {
    expect(
      sourceHref(
        {
          type: "issue",
          key: "voicevox/voicevox#10",
        },
        range,
      ),
    ).toBe(
      "#/issues/voicevox/voicevox/10?start=2026-07-01&end=2026-07-31",
    );
  });
});
