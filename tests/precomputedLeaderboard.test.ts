import { describe, expect, it } from "vitest";
import type {
  Actor,
  LeaderboardDataset,
  PreparedMergedPull,
  PreparedPull,
} from "../src/domain/model";
import { calculateLeaderboard } from "../src/services/calculateLeaderboard";

const alice = actor("alice");
const bob = actor("bob");
const carol = actor("carol");
const dave = actor("dave");

const dataset: LeaderboardDataset = {
  schemaVersion: 4,
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

  it("未マージ PR を同じ関連 Issue のマージ済み PR と分ける", () => {
    const openPull: PreparedPull = {
      ...pull(3, "2026-07-15T00:00:00Z"),
      outcome: { kind: "open" },
    };
    const unmergedDataset: LeaderboardDataset = {
      ...dataset,
      pulls: [pull(1, "2026-07-10T00:00:00Z"), openPull],
    };

    const result = calculateLeaderboard(unmergedDataset, dataset.range);
    const mergedWorkstream = findPullWorkstream(result, 1);
    const openWorkstream = findPullWorkstream(result, 3);

    expect(result.workstreams).toHaveLength(2);
    expect(mergedWorkstream.key).toBe("voicevox/voicevox#10");
    expect(openWorkstream.key).toBe("pr:voicevox/voicevox#3");
    expect(mergedWorkstream.pulls).toHaveLength(1);
    expect(openWorkstream.pulls).toHaveLength(1);
    expect(mergedWorkstream.effectiveLines).toBe(20);
  });

  it("同じ関連 Issue の未マージ PR を一件ずつ分ける", () => {
    const firstOpenPull: PreparedPull = {
      ...pull(3, "2026-07-15T00:00:00Z"),
      outcome: { kind: "open" },
    };
    const secondOpenPull: PreparedPull = {
      ...pull(4, "2026-07-16T00:00:00Z"),
      outcome: { kind: "open" },
    };
    const unmergedDataset: LeaderboardDataset = {
      ...dataset,
      pulls: [firstOpenPull, secondOpenPull],
    };

    const result = calculateLeaderboard(unmergedDataset, dataset.range);

    expect(result.workstreams).toHaveLength(2);
    expect(result.workstreams.map((workstream) => workstream.key)).toEqual([
      "pr:voicevox/voicevox#3",
      "pr:voicevox/voicevox#4",
    ]);
    expect(
      result.workstreams.every((workstream) => workstream.pulls.length === 1),
    ).toBe(true);
  });

  it("レビュー保証があるオープン PR の実装枠をマージ済みの半分にする", () => {
    const mergedPull: PreparedMergedPull = {
      ...pull(11, "2026-07-15T00:00:00Z"),
      issueKey: undefined,
    };
    const openPull: PreparedPull = {
      ...mergedPull,
      outcome: { kind: "open" },
    };

    const mergedWorkstream = calculateSinglePullWorkstream(mergedPull);
    const openWorkstream = calculateSinglePullWorkstream(openPull);

    expect(mergedWorkstream.implementationPoints).toBeCloseTo(
      mergedWorkstream.importance * 0.65,
      12,
    );
    expect(openWorkstream.implementationPoints).toBeCloseTo(
      openWorkstream.importance * 0.375,
      12,
    );
  });

  it("レビュー保証があるクローズ済み未マージ PR の実装枠をマージ済みの四分の一にする", () => {
    const mergedPull: PreparedMergedPull = {
      ...pull(12, "2026-07-15T00:00:00Z"),
      issueKey: undefined,
    };
    const closedPull: PreparedPull = {
      ...mergedPull,
      outcome: {
        kind: "closed",
        closedAt: "2026-07-15T00:00:00Z",
      },
    };

    const mergedWorkstream = calculateSinglePullWorkstream(mergedPull);
    const closedWorkstream = calculateSinglePullWorkstream(closedPull);

    expect(mergedWorkstream.implementationPoints).toBeCloseTo(
      mergedWorkstream.importance * 0.65,
      12,
    );
    expect(closedWorkstream.implementationPoints).toBeCloseTo(
      closedWorkstream.importance * 0.2375,
      12,
    );
  });

  it("レビュー保証がない未マージ PR の実装枠を配分しない", () => {
    const openPull: PreparedPull = {
      ...pull(13, "2026-07-15T00:00:00Z"),
      outcome: { kind: "open" },
      reviews: [],
      reviewThreads: [],
      issueKey: undefined,
    };

    const workstream = calculateSinglePullWorkstream(openPull);
    const assuranceLoss = workstream.unallocatedEntries.find(
      (entry) =>
        entry.id ===
        openPull.key + ":implementation:review-assurance:unallocated",
    );

    expect(workstream.implementationPoints).toBeCloseTo(
      workstream.importance * 0.1,
      12,
    );
    expect(workstream.allocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: openPull.key + ":implementation:creation",
          actor: alice,
          kind: "implementation",
          points: workstream.importance * 0.1,
        }),
      ]),
    );
    expect(assuranceLoss?.points).toBeCloseTo(
      workstream.importance * 0.55,
      12,
    );
  });

  it("作成ポイントを共同作者へ配分しない", () => {
    const coauthoredPull: PreparedPull = {
      ...pull(20, "2026-07-15T00:00:00Z"),
      outcome: { kind: "open" },
      coauthors: [bob],
      reviews: [],
      reviewThreads: [],
      issueKey: undefined,
    };

    const workstream = calculateSinglePullWorkstream(coauthoredPull);
    const creationAllocations = workstream.allocations.filter((allocation) =>
      allocation.id === coauthoredPull.key + ":implementation:creation"
    );

    expect(creationAllocations).toHaveLength(1);
    expect(creationAllocations[0]).toMatchObject({
      actor: alice,
      kind: "implementation",
      points: workstream.importance * 0.1,
    });
    expect(
      creationAllocations.some((allocation) => allocation.actor.login === bob.login),
    ).toBe(false);
  });

  it("未マージ PR のレビュー枠へ状態係数を掛けない", () => {
    const mergedPull: PreparedMergedPull = {
      ...pull(14, "2026-07-15T00:00:00Z"),
      issueKey: undefined,
    };
    const openPull: PreparedPull = {
      ...mergedPull,
      outcome: { kind: "open" },
    };

    const mergedWorkstream = calculateSinglePullWorkstream(mergedPull);
    const openWorkstream = calculateSinglePullWorkstream(openPull);

    expect(openWorkstream.reviewPoints).toBeCloseTo(
      mergedWorkstream.reviewPoints,
      12,
    );
  });

  it("未マージ PR のワークストリームへ関連 Issue 枠を配分しない", () => {
    const openPull: PreparedPull = {
      ...pull(15, "2026-07-15T00:00:00Z"),
      outcome: { kind: "open" },
    };
    const unmergedDataset: LeaderboardDataset = {
      ...dataset,
      pulls: [openPull],
    };

    const result = calculateLeaderboard(unmergedDataset, dataset.range);
    const workstream = findPullWorkstream(result, openPull.number);
    const issueLoss = workstream.unallocatedEntries.find(
      (entry) => entry.kind === "issue",
    );

    expect(workstream.issuePoints).toBe(0);
    expect(issueLoss?.points).toBeCloseTo(workstream.importance * 0.15, 12);
    expect(issueLoss?.reason).toBe("未マージ PR のため関連 Issue 枠は配点対象外");
  });

  it("期間末より後にマージされた PR をオープンとして採点する", () => {
    const mergedLater: PreparedMergedPull = {
      ...pull(16, "2026-07-20T00:00:00Z"),
      createdAt: "2026-07-05T00:00:00Z",
      reviews: [
        {
          actor: bob,
          submittedAt: "2026-07-10T00:00:00Z",
          state: "APPROVED",
          hasSubstantiveSummary: true,
        },
      ],
      issueKey: undefined,
    };
    const laterDataset: LeaderboardDataset = {
      ...dataset,
      pulls: [mergedLater],
      issues: [],
    };

    const result = calculateLeaderboard(laterDataset, {
      start: "2026-07-01",
      end: "2026-07-15",
    });
    const workstream = findPullWorkstream(result, mergedLater.number);

    expect(workstream.key).toBe("pr:" + mergedLater.key);
    expect(workstream.implementationPoints).toBeCloseTo(
      workstream.importance * 0.375,
      12,
    );
  });

  it("期間末より後のレビューをオープン PR のレビュー保証に使わない", () => {
    const mergedLater: PreparedMergedPull = {
      ...pull(19, "2026-07-25T00:00:00Z"),
      createdAt: "2026-07-05T00:00:00Z",
      reviews: [
        {
          actor: bob,
          submittedAt: "2026-07-16T00:00:00Z",
          state: "APPROVED",
          hasSubstantiveSummary: true,
        },
      ],
      issueKey: undefined,
    };
    const laterDataset: LeaderboardDataset = {
      ...dataset,
      pulls: [mergedLater],
      issues: [],
    };

    const result = calculateLeaderboard(laterDataset, {
      start: "2026-07-01",
      end: "2026-07-15",
    });
    const workstream = findPullWorkstream(result, mergedLater.number);

    expect(workstream.implementationPoints).toBeCloseTo(
      workstream.importance * 0.1,
      12,
    );
    expect(workstream.unallocatedEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id:
            mergedLater.key +
            ":implementation:review-assurance:unallocated",
        }),
      ]),
    );
  });

  it("配点対象日が期間外でも期間内のレビューへレビュー枠を配分する", () => {
    const openPull: PreparedPull = {
      ...pull(17, "2026-07-10T00:00:00Z"),
      createdAt: "2026-06-20T00:00:00Z",
      outcome: { kind: "open" },
      issueKey: undefined,
    };
    const reviewDataset: LeaderboardDataset = {
      ...dataset,
      pulls: [openPull],
      issues: [],
    };

    const result = calculateLeaderboard(reviewDataset, dataset.range);
    const workstream = findPullWorkstream(result, openPull.number);

    expect(workstream.implementationPoints).toBe(0);
    expect(workstream.reviewPoints).toBeGreaterThan(0);
    expect(workstream.unallocatedEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: openPull.key + ":implementation:scoring-date:unallocated",
        }),
      ]),
    );
  });

  it("期間外作成と Bot 作者の作成ポイントを対象外明細へ記録する", () => {
    const outOfRangePull: PreparedMergedPull = {
      ...pull(21, "2026-07-15T00:00:00Z"),
      createdAt: "2026-06-30T00:00:00Z",
      issueKey: undefined,
    };
    const botPull: PreparedMergedPull = {
      ...pull(22, "2026-07-15T00:00:00Z"),
      author: actor("dependabot[bot]"),
      authorIsHuman: false,
      reviews: [],
      reviewThreads: [],
      issueKey: undefined,
    };
    const result = calculateLeaderboard(
      {
        ...dataset,
        pulls: [outOfRangePull, botPull],
        issues: [],
      },
      dataset.range,
    );
    const outOfRangeWorkstream = findPullWorkstream(result, 21);
    const botWorkstream = findPullWorkstream(result, 22);
    const outOfRangeLoss = outOfRangeWorkstream.unallocatedEntries.find(
      (entry) =>
        entry.id === outOfRangePull.key + ":implementation:creation:unallocated",
    );
    const botLoss = botWorkstream.unallocatedEntries.find(
      (entry) =>
        entry.id === botPull.key + ":implementation:creation:unallocated",
    );

    expect(outOfRangeLoss).toEqual({
      id: outOfRangePull.key + ":implementation:creation:unallocated",
      kind: "implementation",
      points: outOfRangeWorkstream.importance * 0.1,
      source: { type: "pull", key: outOfRangePull.key },
      sourceTitle: expect.any(String),
      reason:
        "PR 作成日 2026-06-30T00:00:00Z が期間外のため PR 作成ポイントは配点対象外",
    });
    expect(botLoss).toEqual({
      id: botPull.key + ":implementation:creation:unallocated",
      kind: "implementation",
      points: botWorkstream.importance * 0.1,
      source: { type: "pull", key: botPull.key },
      sourceTitle: expect.any(String),
      reason:
        "作者 dependabot[bot] が Bot のため PR 作成ポイントは配点対象外",
    });
    expect(
      outOfRangeWorkstream.allocations.some((allocation) =>
        allocation.id === outOfRangePull.key + ":implementation:creation"
      ),
    ).toBe(false);
    expect(
      botWorkstream.allocations.some((allocation) =>
        allocation.id === botPull.key + ":implementation:creation"
      ),
    ).toBe(false);
  });

  it("未マージ PR の関連 Issue を独立 Issue として採点し続ける", () => {
    const openPull: PreparedPull = {
      ...pull(18, "2026-07-15T00:00:00Z"),
      outcome: { kind: "open" },
    };
    const unmergedDataset: LeaderboardDataset = {
      ...dataset,
      pulls: [openPull],
    };

    const result = calculateLeaderboard(unmergedDataset, dataset.range);

    expect(result.standaloneIssues.map((issue) => issue.key)).toEqual([
      "voicevox/voicevox#10",
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

  it("配点と配点対象外の点からワークストリーム重要度を復元できる", () => {
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
        reason: expect.stringContaining("上限 5 に満たないため残りは配点対象外"),
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

    expect(new Set(implementationSources)).toEqual(
      new Set(["voicevox/voicevox#1", "voicevox/voicevox#2"]),
    );
    expect(issueReasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Issue 作成"),
        expect.stringContaining("Issue 本文の証拠要素"),
        expect.stringContaining("実質的コメント"),
      ]),
    );
    expect(new Set(traceIds).size).toBe(traceIds.length);
  });

  it("関連 Issue とレビューがない枠を配点対象外とする", () => {
    const independentPull: PreparedMergedPull = {
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
        reason: "配点対象の人間レビューがないためレビュー枠は配点対象外",
      }),
      expect.objectContaining({
        kind: "issue",
        reason: "関連 Issue がないため Issue 枠は配点対象外",
      }),
    ]);
  });

  it("独立した品質確認がない実装枠の半分を配点対象外とする", () => {
    const unreviewedPull: PreparedMergedPull = {
      ...pull(3, "2026-07-15T00:00:00Z"),
      outcome: {
        kind: "merged",
        mergedAt: "2026-07-15T00:00:00Z",
        mergedBy: alice,
        mergedByIsHuman: true,
      },
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
      workstream.importance * 0.375,
      12,
    );
    expect(workstream.unallocatedPoints).toBeCloseTo(
      workstream.importance * 0.625,
      12,
    );
    const qualityLoss = workstream.unallocatedEntries.find(
      (entry) =>
        entry.id ===
        unreviewedPull.key + ":implementation:review-assurance:unallocated",
    );
    expect(qualityLoss?.points).toBeCloseTo(workstream.importance * 0.275, 12);
    expect(qualityLoss?.reason).toContain("独立した品質確認なし");
  });

  it("フルAI実装リポジトリの実装枠を 30%だけ配分する", () => {
    const fullAiPull: PreparedMergedPull = {
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
      workstream.importance * 0.265,
      12,
    );
    const fullAiLoss = workstream.unallocatedEntries.find(
      (entry) =>
        entry.id === fullAiPull.key + ":implementation:full-ai:unallocated",
    );
    expect(fullAiLoss?.points).toBeCloseTo(workstream.importance * 0.385, 12);
    expect(fullAiLoss?.reason).toBe(
      "フルAI実装リポジトリのため実装枠の70%が配点対象外",
    );
  });

  it("フルAI実装リポジトリの未レビュー PR へ両方の配分率を掛ける", () => {
    const fullAiPull: PreparedMergedPull = {
      ...pull(7, "2026-07-15T00:00:00Z"),
      fullAiImplementation: true,
      outcome: {
        kind: "merged",
        mergedAt: "2026-07-15T00:00:00Z",
        mergedBy: alice,
        mergedByIsHuman: true,
      },
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
      workstream.importance * 0.1825,
      12,
    );
    expect(
      workstream.allocations.map((allocation) => allocation.reason),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "フルAI実装リポジトリかつ独立した品質確認なしとして実装枠の15%を配分",
        ),
      ]),
    );
    const qualityLoss = workstream.unallocatedEntries.find(
      (entry) =>
        entry.id ===
        fullAiPull.key + ":implementation:review-assurance:unallocated",
    );
    expect(qualityLoss?.points).toBeCloseTo(workstream.importance * 0.0825, 12);
    expect(qualityLoss?.reason).toBe(
      "独立した品質確認なしのため実装枠の15%が配点対象外",
    );
  });

  it("Bot 作者へ渡らない実装枠を配点対象外とする", () => {
    const botPull: PreparedMergedPull = {
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
          reason: expect.stringContaining("Bot のため作者分は配点対象外"),
        }),
      ]),
    );
  });

  it("レビューの加点を参加、総評、個別スレッドへ分ける", () => {
    const reviewedPull: PreparedMergedPull = {
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

function calculateSinglePullWorkstream(
  targetPull: PreparedPull,
): ReturnType<typeof calculateLeaderboard>["workstreams"][number] {
  const singlePullDataset: LeaderboardDataset = {
    ...dataset,
    pulls: [targetPull],
    issues: [],
  };
  const result = calculateLeaderboard(singlePullDataset, dataset.range);
  return findPullWorkstream(result, targetPull.number);
}

function findPullWorkstream(
  result: ReturnType<typeof calculateLeaderboard>,
  pullNumber: number,
): ReturnType<typeof calculateLeaderboard>["workstreams"][number] {
  const workstream = result.workstreams.find((candidate) =>
    candidate.pulls.some((targetPull) => targetPull.number === pullNumber),
  );
  if (workstream == null) {
    throw new Error("検証対象の PR ワークストリームがありません。");
  }
  return workstream;
}

function pull(number: number, mergedAt: string): PreparedMergedPull {
  return {
    key: "voicevox/voicevox#" + number,
    repository: "VOICEVOX/voicevox",
    number,
    title: "feat: 音声合成を改善する",
    githubUrl: "https://github.com/VOICEVOX/voicevox/pull/" + number,
    createdAt: mergedAt,
    outcome: {
      kind: "merged",
      mergedAt,
      mergedBy: bob,
      mergedByIsHuman: true,
    },
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
