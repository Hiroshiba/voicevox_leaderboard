import { describe, expect, it } from "vitest";
import type {
  Actor,
  LeaderboardDataset,
  PreparedPull,
} from "../src/domain/model";
import { calculateLeaderboard } from "../src/services/calculateLeaderboard";

const alice = actor("alice");
const bob = actor("bob");
const carol = actor("carol");
const dave = actor("dave");

const dataset: LeaderboardDataset = {
  schemaVersion: 1,
  organization: "VOICEVOX",
  generatedAt: "2026-08-02T00:00:00Z",
  range: {
    start: "2026-07-01",
    end: "2026-07-31",
  },
  repositories: [
    {
      nameWithOwner: "VOICEVOX/voicevox",
      fork: false,
      mirror: false,
    },
  ],
  pulls: [
    pull(1, "2026-07-10T00:00:00Z"),
    pull(2, "2026-07-20T00:00:00Z"),
  ],
  issues: [
    {
      key: "voicevox/voicevox#10",
      repository: "VOICEVOX/voicevox",
      number: 10,
      title: "音声合成を改善する",
      githubUrl: "https://github.com/VOICEVOX/voicevox/issues/10",
      author: carol,
      authorIsHuman: true,
      state: "closed",
      stateReason: "completed",
      createdAt: "2026-07-02T00:00:00Z",
      closedAt: "2026-07-25T00:00:00Z",
      labels: [],
      bodyEvidenceKinds: ["measurement"],
      comments: [
        {
          actor: dave,
          createdAt: "2026-07-05T00:00:00Z",
          substantive: true,
          evidenceKinds: ["attachment"],
        },
      ],
      activityCandidate: true,
    },
  ],
  notices: ["検証"],
  acquisition: {
    networkRequests: 20,
    cacheRevalidations: 0,
    notModifiedResponses: 0,
  },
};

describe("calculateLeaderboard", () => {
  it("同じ関連 Issue の PR を一つのワークストリームへまとめる", () => {
    const result = calculateLeaderboard(dataset, dataset.range);

    expect(result.workstreams).toHaveLength(1);
    expect(result.workstreams[0]).toMatchObject({
      key: "voicevox/voicevox#10",
      source: {
        type: "issue",
        key: "voicevox/voicevox#10",
      },
      repositoryCount: 1,
    });
    expect(result.workstreams[0]?.pulls).toHaveLength(2);
    expect(result.standaloneIssues).toHaveLength(0);
    expect(result.contributors.map((contributor) => contributor.login)).toEqual(
      expect.arrayContaining(["alice", "bob", "carol", "dave"]),
    );
  });

  it("期間外にマージされた PR を計算へ含めない", () => {
    const result = calculateLeaderboard(dataset, {
      start: "2026-07-01",
      end: "2026-07-15",
    });

    expect(result.workstreams).toHaveLength(1);
    expect(result.workstreams[0]?.pulls.map((pullScore) => pullScore.number)).toEqual([
      1,
    ]);
  });

  it("取得統計が異なっても計算結果を変えない", () => {
    const cachedDataset: LeaderboardDataset = {
      ...dataset,
      acquisition: {
        networkRequests: 20,
        cacheRevalidations: 20,
        notModifiedResponses: 20,
      },
    };

    expect(calculateLeaderboard(cachedDataset, dataset.range)).toEqual(
      calculateLeaderboard(dataset, dataset.range),
    );
  });
});

function pull(number: number, mergedAt: string): PreparedPull {
  return {
    key: "voicevox/voicevox#" + number,
    repository: "VOICEVOX/voicevox",
    number,
    title: "feat: 音声合成を改善する",
    githubUrl: "https://github.com/VOICEVOX/voicevox/pull/" + number,
    mergedAt,
    author: alice,
    authorIsHuman: true,
    coauthors: [],
    files: [
      {
        filename: "src/index.ts",
        additions: 20,
        deletions: 0,
        effectiveLines: 20,
        generated: false,
      },
    ],
    effectiveLines: 20,
    nonGeneratedFiles: 1,
    mass: 2.5,
    conventionalBonus: 1,
    reviews: [
      {
        actor: bob,
        submittedAt: mergedAt,
        hasSubstantiveSummary: true,
      },
    ],
    reviewThreads: [],
    issueKey: "voicevox/voicevox#10",
  };
}

function actor(login: string): Actor {
  return {
    login,
    avatarUrl: "https://github.com/" + login + ".png",
  };
}
