import { describe, expect, it } from "vitest";
import {
  extractClosingReferences,
  extractGithubReferences,
  extractRelatedIssueReferences,
} from "../src/domain/references";

describe("extractGithubReferences", () => {
  it("ローカル参照、修飾参照、URL を出現順に抽出する", () => {
    const references = extractGithubReferences(
      [
        "#12",
        "VOICEVOX/voicevox_engine#34",
        "https://github.com/VOICEVOX/voicevox_core/pull/56",
      ].join("\n"),
      "VOICEVOX",
      "voicevox",
    );

    expect(references).toEqual([
      {
        owner: "VOICEVOX",
        repository: "voicevox",
        number: 12,
        hint: "unknown",
      },
      {
        owner: "VOICEVOX",
        repository: "voicevox_engine",
        number: 34,
        hint: "unknown",
      },
      {
        owner: "VOICEVOX",
        repository: "voicevox_core",
        number: 56,
        hint: "pull",
      },
    ]);
  });
});

describe("extractClosingReferences", () => {
  it("Closing keyword に続く最初の参照を抽出する", () => {
    expect(
      extractClosingReferences(
        "Fixes #42\nResolves VOICEVOX/voicevox_engine#100",
        "VOICEVOX",
        "voicevox",
      ),
    ).toEqual([
      {
        owner: "VOICEVOX",
        repository: "voicevox",
        number: 42,
        hint: "unknown",
      },
      {
        owner: "VOICEVOX",
        repository: "voicevox_engine",
        number: 100,
        hint: "unknown",
      },
    ]);
  });
});

describe("extractRelatedIssueReferences", () => {
  it("関連 Issue セクションだけを抽出する", () => {
    expect(
      extractRelatedIssueReferences(
        [
          "# 概要",
          "#1",
          "## 関連 Issue",
          "- #2733",
          "## 補足",
          "#999",
        ].join("\n"),
        "VOICEVOX",
        "voicevox",
      ),
    ).toEqual([
      {
        owner: "VOICEVOX",
        repository: "voicevox",
        number: 2733,
        hint: "unknown",
      },
    ]);
  });
});
