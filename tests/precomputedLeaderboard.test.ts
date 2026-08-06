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
  schemaVersion: 3,
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
      fullAiImplementation: false,
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

  it("配点と未配分点からワークストリーム重要度を復元できる", () => {
    const result = calculateLeaderboard(dataset, dataset.range);
    const workstream = result.workstreams[0];
    expect(workstream).toBeDefined();
    if (workstream == null) {
      throw new Error("検証対象のワークストリームがありません。");
    }

    const allocations = workstream.allocations.reduce(
      (total, allocation) => total + allocation.points,
      0,
    );
    const unallocated = workstream.unallocatedEntries.reduce(
      (total, entry) => total + entry.points,
      0,
    );

    expect(allocations + unallocated).toBeCloseTo(workstream.importance, 12);
    expect(workstream.unallocatedPoints).toBeCloseTo(unallocated, 12);
    expect(workstream.unallocatedEntries).toEqual([
      expect.objectContaining({
        kind: "review",
        reason: expect.stringContaining("上限 5 に満たないため未配分"),
      }),
    ]);
  });

  it("配点を個別の PR と Issue 活動まで追跡できる", () => {
    const result = calculateLeaderboard(dataset, dataset.range);
    const workstream = result.workstreams[0];
    expect(workstream).toBeDefined();
    if (workstream == null) {
      throw new Error("検証対象のワークストリームがありません。");
    }

    const implementationSources = workstream.allocations
      .filter((allocation) => allocation.kind === "implementation")
      .map((allocation) => allocation.source.key);
    const issueReasons = workstream.allocations
      .filter((allocation) => allocation.kind === "issue")
      .map((allocation) => allocation.reason);
    const traceIds = [
      ...workstream.allocations.map((allocation) => allocation.id),
      ...workstream.unallocatedEntries.map((entry) => entry.id),
    ];

    expect(implementationSources).toEqual([
      "voicevox/voicevox#1",
      "voicevox/voicevox#2",
    ]);
    expect(issueReasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Issue 作成"),
        expect.stringContaining("Issue 本文の証拠要素"),
        expect.stringContaining("実質的コメント"),
      ]),
    );
    expect(new Set(traceIds).size).toBe(traceIds.length);
  });

  it("関連 Issue とレビューがない枠を未配分として残す", () => {
    const independentPull: PreparedPull = {
      ...pull(3, "2026-07-15T00:00:00Z"),
      reviews: [],
      reviewThreads: [],
      issueKey: undefined,
    };
    const independentDataset: LeaderboardDataset = {
      ...dataset,
      pulls: [independentPull],
      issues: [],
    };

    const result = calculateLeaderboard(independentDataset, dataset.range);
    const workstream = result.workstreams[0];
    expect(workstream).toBeDefined();
    if (workstream == null) {
      throw new Error("検証対象のワークストリームがありません。");
    }

    expect(workstream.unallocatedPoints).toBeCloseTo(
      workstream.importance * 0.35,
      12,
    );
    expect(workstream.unallocatedEntries).toEqual([
      expect.objectContaining({
        kind: "review",
        reason: "配点対象の人間レビューがないため未配分",
      }),
      expect.objectContaining({
        kind: "issue",
        reason: "関連 Issue がないため未配分",
      }),
    ]);
  });

  it("独立した品質確認がない実装枠の半分を未配分にする", () => {
    const unreviewedPull: PreparedPull = {
      ...pull(3, "2026-07-15T00:00:00Z"),
      mergedBy: alice,
      reviews: [],
      reviewThreads: [],
      issueKey: undefined,
    };
    const unreviewedDataset: LeaderboardDataset = {
      ...dataset,
      pulls: [unreviewedPull],
      issues: [],
    };

    const result = calculateLeaderboard(unreviewedDataset, dataset.range);
    const workstream = result.workstreams[0];
    expect(workstream).toBeDefined();
    if (workstream == null) {
      throw new Error("検証対象のワークストリームがありません。");
    }

    expect(workstream.implementationPoints).toBeCloseTo(
      workstream.importance * 0.325,
      12,
    );
    expect(workstream.unallocatedPoints).toBeCloseTo(
      workstream.importance * 0.675,
      12,
    );
    const qualityLoss = workstream.unallocatedEntries.find(
      (entry) =>
        entry.id ===
        unreviewedPull.key + ":implementation:review-assurance:unallocated",
    );
    expect(qualityLoss?.points).toBeCloseTo(workstream.importance * 0.325, 12);
    expect(qualityLoss?.reason).toContain("独立した品質確認なし");
  });

  it("フルAI実装リポジトリの実装枠を 30%だけ配分する", () => {
    const fullAiPull: PreparedPull = {
      ...pull(6, "2026-07-15T00:00:00Z"),
      fullAiImplementation: true,
      issueKey: undefined,
    };
    const fullAiDataset: LeaderboardDataset = {
      ...dataset,
      pulls: [fullAiPull],
      issues: [],
    };

    const result = calculateLeaderboard(fullAiDataset, dataset.range);
    const workstream = result.workstreams[0];
    expect(workstream).toBeDefined();
    if (workstream == null) {
      throw new Error("検証対象のワークストリームがありません。");
    }

    expect(workstream.implementationPoints).toBeCloseTo(
      workstream.importance * 0.195,
      12,
    );
    const fullAiLoss = workstream.unallocatedEntries.find(
      (entry) =>
        entry.id === fullAiPull.key + ":implementation:full-ai:unallocated",
    );
    expect(fullAiLoss?.points).toBeCloseTo(workstream.importance * 0.455, 12);
    expect(fullAiLoss?.reason).toBe(
      "フルAI実装リポジトリのため実装枠の70%を未配分",
    );
  });

  it("フルAI実装リポジトリの未レビュー PR へ両方の配分率を掛ける", () => {
    const fullAiPull: PreparedPull = {
      ...pull(7, "2026-07-15T00:00:00Z"),
      fullAiImplementation: true,
      mergedBy: alice,
      reviews: [],
      reviewThreads: [],
      issueKey: undefined,
    };
    const fullAiDataset: LeaderboardDataset = {
      ...dataset,
      pulls: [fullAiPull],
      issues: [],
    };

    const result = calculateLeaderboard(fullAiDataset, dataset.range);
    const workstream = result.workstreams[0];
    expect(workstream).toBeDefined();
    if (workstream == null) {
      throw new Error("検証対象のワークストリームがありません。");
    }

    expect(workstream.implementationPoints).toBeCloseTo(
      workstream.importance * 0.0975,
      12,
    );
    expect(
      workstream.allocations.map((allocation) => allocation.reason),
    ).toEqual([
      expect.stringContaining(
        "フルAI実装リポジトリかつ独立した品質確認なしとして実装枠の15%を配分",
      ),
    ]);
    const qualityLoss = workstream.unallocatedEntries.find(
      (entry) =>
        entry.id ===
        fullAiPull.key + ":implementation:review-assurance:unallocated",
    );
    expect(qualityLoss?.points).toBeCloseTo(workstream.importance * 0.0975, 12);
    expect(qualityLoss?.reason).toBe(
      "独立した品質確認なしのため実装枠の15%を未配分",
    );
  });

  it("Bot 作者へ渡らない実装枠を未配分として残す", () => {
    const botPull: PreparedPull = {
      ...pull(4, "2026-07-15T00:00:00Z"),
      author: actor("dependabot[bot]"),
      authorIsHuman: false,
      reviews: [],
      reviewThreads: [],
      issueKey: undefined,
    };
    const botDataset: LeaderboardDataset = {
      ...dataset,
      pulls: [botPull],
      issues: [],
    };

    const result = calculateLeaderboard(botDataset, dataset.range);
    const workstream = result.workstreams[0];
    expect(workstream).toBeDefined();
    if (workstream == null) {
      throw new Error("検証対象のワークストリームがありません。");
    }

    expect(result.contributors).toHaveLength(0);
    expect(workstream.unallocatedPoints).toBeCloseTo(workstream.importance, 12);
    expect(workstream.unallocatedEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "implementation",
          reason: expect.stringContaining("Bot のため作者分を未配分"),
        }),
      ]),
    );
  });

  it("レビューの加点を参加、総評、個別スレッドへ分ける", () => {
    const reviewedPull: PreparedPull = {
      ...pull(5, "2026-07-15T00:00:00Z"),
      reviewThreads: [
        {
          actor: bob,
          createdAt: "2026-07-13T00:00:00Z",
        },
        {
          actor: bob,
          createdAt: "2026-07-14T00:00:00Z",
        },
      ],
      issueKey: undefined,
    };
    const reviewedDataset: LeaderboardDataset = {
      ...dataset,
      pulls: [reviewedPull],
      issues: [],
    };

    const result = calculateLeaderboard(reviewedDataset, dataset.range);
    const workstream = result.workstreams[0];
    expect(workstream).toBeDefined();
    if (workstream == null) {
      throw new Error("検証対象のワークストリームがありません。");
    }
    const reviews = workstream.allocations.filter(
      (allocation) => allocation.kind === "review",
    );
    const reviewLoss = workstream.unallocatedEntries.find(
      (entry) => entry.kind === "review",
    );

    expect(reviews).toHaveLength(4);
    expect(reviews.map((allocation) => allocation.reason)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("レビュー参加"),
        expect.stringContaining("レビュー総評"),
        expect.stringContaining("レビュースレッド 1 件目"),
        expect.stringContaining("レビュースレッド 2 件目"),
      ]),
    );
    expect(
      reviews.every(
        (allocation) => allocation.source.key === reviewedPull.key,
      ),
    ).toBe(true);
    expect(reviewLoss?.points).toBeCloseTo(workstream.importance * 0.04, 12);
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
    mergedBy: bob,
    mergedByIsHuman: true,
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
    fullAiImplementation: false,
    reviews: [
      {
        actor: bob,
        submittedAt: mergedAt,
        state: "APPROVED",
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
