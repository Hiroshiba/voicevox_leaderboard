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
});

function datasetWithOutcome(outcome: unknown): unknown {
  return {
    schemaVersion: 4,
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
        effectiveLines: 0,
        nonGeneratedFiles: 0,
        mass: 1,
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
