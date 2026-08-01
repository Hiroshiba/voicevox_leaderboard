import { describe, expect, it } from "vitest";
import { parseCalculationScope } from "../src/services/calculationScope";

describe("parseCalculationScope", () => {
  it("大文字小文字だけが異なる同一リポジトリを一つにする", () => {
    const scope = parseCalculationScope({
      organization: "VOICEVOX",
      repositories: ["VOICEVOX/voicevox", "voicevox/VoiceVox"],
      range: {
        start: "2026-07-01",
        end: "2026-07-31",
      },
    });

    expect(scope.repositories).toEqual(["VOICEVOX/voicevox"]);
  });

  it("暦に存在しない日付を拒否する", () => {
    expect(() =>
      parseCalculationScope({
        organization: "VOICEVOX",
        repositories: ["VOICEVOX/voicevox"],
        range: {
          start: "2026-02-30",
          end: "2026-03-01",
        },
      }),
    ).toThrow("実在する日付を指定してください。");
  });
});
