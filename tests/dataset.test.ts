import { describe, expect, it } from "vitest";
import { parseLeaderboardDataset } from "../src/domain/dataset";

const actor = {
  login: "alice",
  avatarUrl: "https://github.com/alice.png",
};

describe("parseLeaderboardDataset", () => {
  it.each([
    [
      "マージ済み",
      {
        kind: "merged",
        mergedAt: "2026-07-10T00:00:00Z",
        mergedBy: actor,
        mergedByIsHuman: true,
      },
    ],
    [
      "オープン",
      {
        kind: "open",
      },
    ],
    [
      "クローズ済み",
      {
        kind: "closed",
        closedAt: "2026-07-10T00:00:00Z",
      },
    ],
  ])("%s PR の outcome を受け付ける", (_label, outcome) => {
    const parsed = parseLeaderboardDataset(datasetWithOutcome(outcome));

    expect(parsed.pulls[0]?.outcome).toEqual(outcome);
  });

  it.each([
    [
      "マージ者がないマージ済み",
      {
        kind: "merged",
        mergedAt: "2026-07-10T00:00:00Z",
        mergedByIsHuman: true,
      },
    ],
    ["クローズ日時がないクローズ済み", { kind: "closed" }],
    [
      "クローズ日時を持つオープン",
      {
        kind: "open",
        closedAt: "2026-07-10T00:00:00Z",
      },
    ],
  ])("%s PR の outcome を拒否する", (_label, outcome) => {
    expect(() => parseLeaderboardDataset(datasetWithOutcome(outcome))).toThrow();
  });

  it("測定済み、生成物、未測定のファイル分析を受け付ける", () => {
    const dataset = datasetWithOutcome({ kind: "open" });
    const pull = dataset.pulls[0];
    if (pull == null) {
      throw new Error("検証対象の PR がありません。");
    }
    pull.files = [
      {
        filename: "src/index.ts",
        additions: 1,
        deletions: 0,
        analysis: {
          kind: "measured",
          groups: [
            {
              fingerprint: "a".repeat(64),
              beforeTokens: 1,
              afterTokens: 2,
              occurrences: 1,
              weight: 1,
            },
          ],
        },
      },
      {
        filename: "dist/index.js",
        additions: 1,
        deletions: 0,
        analysis: { kind: "generated" },
      },
      {
        filename: "image.png",
        additions: 1,
        deletions: 0,
        analysis: { kind: "unmeasured", reason: "binary" },
      },
    ];

    expect(parseLeaderboardDataset(dataset).pulls[0]?.files).toHaveLength(3);
  });

  it("編集グループの fingerprint は SHA256 形式だけを受け付ける", () => {
    const dataset = datasetWithOutcome({ kind: "open" });
    const pull = dataset.pulls[0];
    if (pull == null) {
      throw new Error("検証対象の PR がありません。");
    }
    pull.files = [
      {
        filename: "src/index.ts",
        additions: 1,
        deletions: 0,
        analysis: {
          kind: "measured",
          groups: [
            {
              fingerprint: "not-a-digest",
              beforeTokens: 1,
              afterTokens: 2,
              occurrences: 1,
              weight: 1,
            },
          ],
        },
      },
    ];

    expect(() => parseLeaderboardDataset(dataset)).toThrow();
  });
});

function datasetWithOutcome(
  outcome: unknown,
): { pulls: Array<Record<string, unknown>> } & Record<string, unknown> {
  return {
    schemaVersion: 5,
    organization: "VOICEVOX",
    generatedAt: "2026-08-01T00:00:00Z",
    range: {
      start: "2026-07-01",
      end: "2026-07-31",
    },
    repositories: [],
    pulls: [
      {
        key: "voicevox/voicevox#1",
        repository: "VOICEVOX/voicevox",
        number: 1,
        title: "PR",
        githubUrl: "https://github.com/VOICEVOX/voicevox/pull/1",
        createdAt: "2026-07-01T00:00:00Z",
        outcome,
        author: actor,
        authorIsHuman: true,
        coauthors: [],
        files: [],
        conventionalBonus: 0,
        fullAiImplementation: false,
        reviews: [],
        reviewThreads: [],
      },
    ],
    issues: [],
    notices: [],
    acquisition: {
      networkRequests: 0,
      cacheRevalidations: 0,
      notModifiedResponses: 0,
    },
  };
}
