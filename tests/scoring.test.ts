import { describe, expect, it } from "vitest";
import {
  calculateAiActivityCredit,
  calculateConventionalBonus,
  calculateEditGroupAmount,
  calculateImplementationReviewAssurance,
  calculateImplementationStateCredit,
  calculateImportance,
  calculatePullEditContributionRatios,
  calculateStandaloneIssueScore,
  calculateUncompressedEditGroupAmount,
  contributionKinds,
  getPullScoringDate,
  resolvePullOutcomeAtRangeEnd,
  totalAllocations,
} from "../src/domain/scoring";
import type {
  Actor,
  PreparedMergedPull,
  PreparedPull,
  ScoreAllocation,
} from "../src/domain/model";

const alice = actor("alice");
const bob = actor("bob");
const rangeEnd = "2026-07-31";
const basePull: PreparedMergedPull = {
  key: "voicevox/voicevox#1",
  repository: "VOICEVOX/voicevox",
  number: 1,
  title: "feat: 音声合成を改善する",
  githubUrl: "https://github.com/VOICEVOX/voicevox/pull/1",
  createdAt: "2026-07-01T00:00:00Z",
  outcome: {
    kind: "merged",
    mergedAt: "2026-07-10T00:00:00Z",
    mergedBy: alice,
    mergedByIsHuman: true,
  },
  author: alice,
  authorIsHuman: true,
  coauthors: [],
  files: [],
  conventionalBonus: 1,
  fullAiImplementation: false,
  reviews: [],
  reviewThreads: [],
};

describe("calculateEditGroupAmount", () => {
  it("編集グループの反復を対数で圧縮する", () => {
    expect(
      calculateEditGroupAmount({
        fingerprint: "a".repeat(64),
        beforeTokens: 8,
        afterTokens: 16,
        occurrences: 4,
        weight: 0.5,
      }),
    ).toBe(1.5);
  });

  it("トークン数が少ない編集は最小量 1 を使う", () => {
    expect(
      calculateEditGroupAmount({
        fingerprint: "a".repeat(64),
        beforeTokens: 0,
        afterTokens: 0,
        occurrences: 1,
        weight: 1,
      }),
    ).toBe(1);
  });
});

describe("calculateUncompressedEditGroupAmount", () => {
  it("反復を圧縮しない編集量を返す", () => {
    expect(
      calculateUncompressedEditGroupAmount({
        fingerprint: "a".repeat(64),
        beforeTokens: 8,
        afterTokens: 16,
        occurrences: 4,
        weight: 0.5,
      }),
    ).toBe(4);
  });
});

describe("calculateImportance", () => {
  it("編集量と生成物の寄与から評価する", () => {
    const importance = calculateImportance({
      editAmount: 23,
      generatedContribution: 1,
      repositoryCount: 1,
      conventionalBonus: 0.5,
    });

    expect(importance).toBeCloseTo(4.15, 1);
  });

  it("巨大な成果でも 15 を超えない", () => {
    expect(
      calculateImportance({
        editAmount: 100000,
        generatedContribution: 1,
        repositoryCount: 20,
        conventionalBonus: 1.5,
      }),
    ).toBe(15);
  });
});

describe("calculatePullEditContributionRatios", () => {
  it("PR ごとの編集寄与量から比率を返す", () => {
    expect(
      calculatePullEditContributionRatios([
        { pullKey: "pr-1", amount: 2 },
        { pullKey: "pr-2", amount: 1 },
      ]),
    ).toEqual(
      new Map([
        ["pr-1", 2 / 3],
        ["pr-2", 1 / 3],
      ]),
    );
  });

  it("合計量が 0 のとき PR 均等配分へ切り替える", () => {
    expect(
      calculatePullEditContributionRatios([
        { pullKey: "pr-1", amount: 0 },
        { pullKey: "pr-2", amount: 0 },
      ]),
    ).toEqual(
      new Map([
        ["pr-1", 0.5],
        ["pr-2", 0.5],
      ]),
    );
  });
});

describe("resolvePullOutcomeAtRangeEnd", () => {
  it("期間末以前にマージされた PR をマージ済みとして扱う", () => {
    expect(
      resolvePullOutcomeAtRangeEnd(basePull.outcome, "2026-07-10"),
    ).toEqual(basePull.outcome);
  });

  it("期間末より後にマージされた PR をオープンとして扱う", () => {
    expect(
      resolvePullOutcomeAtRangeEnd(basePull.outcome, "2026-07-09"),
    ).toEqual({ kind: "open" });
  });

  it("期間末より後にクローズされた PR をオープンとして扱う", () => {
    expect(
      resolvePullOutcomeAtRangeEnd(
        { kind: "closed", closedAt: "2026-07-10T00:00:00Z" },
        "2026-07-09",
      ),
    ).toEqual({ kind: "open" });
  });
});

describe("getPullScoringDate", () => {
  it("状態ごとにマージ日、クローズ日、作成日を返す", () => {
    expect(getPullScoringDate(basePull.createdAt, basePull.outcome)).toBe(
      "2026-07-10T00:00:00Z",
    );
    expect(
      getPullScoringDate(basePull.createdAt, {
        kind: "closed",
        closedAt: "2026-07-08T00:00:00Z",
      }),
    ).toBe("2026-07-08T00:00:00Z");
    expect(getPullScoringDate(basePull.createdAt, { kind: "open" })).toBe(
      basePull.createdAt,
    );
  });
});

describe("calculateImplementationStateCredit", () => {
  it("状態に応じて実装枠の配分率を返す", () => {
    expect(calculateImplementationStateCredit(basePull.outcome)).toMatchObject({
      type: "merged",
      creditRatio: 1,
    });
    expect(
      calculateImplementationStateCredit({ kind: "open" }),
    ).toMatchObject({
      type: "open",
      creditRatio: 0.5,
    });
    expect(
      calculateImplementationStateCredit({
        kind: "closed",
        closedAt: "2026-07-08T00:00:00Z",
      }),
    ).toMatchObject({
      type: "closed",
      creditRatio: 0.25,
    });
  });
});

describe("calculateAiActivityCredit", () => {
  it("AI 由来の活動を 0.3 倍にする", () => {
    expect(calculateAiActivityCredit(true)).toEqual({
      type: "ai",
      creditRatio: 0.3,
      label: "AI 由来の活動",
    });
  });

  it("通常の活動をそのまま配分する", () => {
    expect(calculateAiActivityCredit(false)).toEqual({
      type: "human",
      creditRatio: 1,
      label: "通常の活動",
    });
  });
});

describe("calculateImplementationReviewAssurance", () => {
  it("独立した品質確認がなければ実装枠を半分にする", () => {
    expect(
      calculateImplementationReviewAssurance(basePull, rangeEnd),
    ).toMatchObject({
      type: "unreviewed",
      creditRatio: 0.5,
    });
  });

  it("作者以外の人間による承認があれば実装枠を全量にする", () => {
    const assurance = calculateMergedReviewAssurance({
      ...basePull,
      reviews: [review(bob, "APPROVED", false, "2026-07-09T00:00:00Z")],
    });

    expect(assurance).toMatchObject({
      type: "approved",
      creditRatio: 1,
    });
  });

  it("マージ後のレビューを品質確認として扱わない", () => {
    const assurance = calculateMergedReviewAssurance({
      ...basePull,
      reviews: [review(bob, "APPROVED", true, "2026-07-11T00:00:00Z")],
      reviewThreads: [
        {
          actor: bob,
          createdAt: "2026-07-11T00:00:00Z",
        },
      ],
    });

    expect(assurance).toMatchObject({
      type: "unreviewed",
      creditRatio: 0.5,
    });
  });

  it("実質的な人間レビューがあれば承認なしでも実装枠を全量にする", () => {
    const assurance = calculateMergedReviewAssurance({
      ...basePull,
      reviews: [review(bob, "COMMENTED", true, "2026-07-09T00:00:00Z")],
    });

    expect(assurance).toMatchObject({
      type: "substantiveReview",
      creditRatio: 1,
    });
  });

  it("作者以外の人間がマージしていれば暗黙の確認として扱う", () => {
    const assurance = calculateMergedReviewAssurance({
      ...basePull,
      outcome: {
        ...basePull.outcome,
        mergedBy: bob,
      },
    });

    expect(assurance).toMatchObject({
      type: "independentMerge",
      creditRatio: 1,
    });
  });

  it("未承認の変更要求が残っていても実質レビュー済みなら実装枠を全量にする", () => {
    const assurance = calculateMergedReviewAssurance({
      ...basePull,
      reviews: [
        review(bob, "CHANGES_REQUESTED", true, "2026-07-09T00:00:00Z"),
      ],
    });

    expect(assurance).toMatchObject({
      type: "substantiveReview",
      creditRatio: 1,
    });
  });

  it("実質内容のない変更要求だけなら独立した品質確認なしとして扱う", () => {
    const assurance = calculateMergedReviewAssurance({
      ...basePull,
      reviews: [
        review(bob, "CHANGES_REQUESTED", false, "2026-07-09T00:00:00Z"),
      ],
    });

    expect(assurance).toMatchObject({
      type: "unreviewed",
      creditRatio: 0.5,
    });
  });

  it("共同作者による承認も作者とは別の人間による確認として扱う", () => {
    const assurance = calculateMergedReviewAssurance({
      ...basePull,
      coauthors: [bob],
      reviews: [review(bob, "APPROVED", true, "2026-07-09T00:00:00Z")],
    });

    expect(assurance).toMatchObject({
      type: "approved",
      creditRatio: 1,
    });
  });

  it("作者本人によるレビューを品質確認として扱わない", () => {
    const assurance = calculateMergedReviewAssurance({
      ...basePull,
      reviews: [review(alice, "APPROVED", true, "2026-07-09T00:00:00Z")],
    });

    expect(assurance).toMatchObject({
      type: "unreviewed",
      creditRatio: 0.5,
    });
  });

  it("クローズ後のレビューを品質確認として扱わない", () => {
    const closedPull: PreparedPull = {
      ...basePull,
      outcome: {
        kind: "closed",
        closedAt: "2026-07-08T00:00:00Z",
      },
      reviews: [review(bob, "APPROVED", true, "2026-07-09T00:00:00Z")],
    };

    expect(
      calculateImplementationReviewAssurance(closedPull, rangeEnd),
    ).toMatchObject({
      type: "unreviewed",
      creditRatio: 0,
    });
  });

  it("クローズ以前のレビューを品質確認として扱う", () => {
    const closedPull: PreparedPull = {
      ...basePull,
      outcome: {
        kind: "closed",
        closedAt: "2026-07-08T00:00:00Z",
      },
      reviews: [review(bob, "APPROVED", true, "2026-07-08T00:00:00Z")],
    };

    expect(
      calculateImplementationReviewAssurance(closedPull, rangeEnd),
    ).toMatchObject({
      type: "approved",
      creditRatio: 1,
    });
  });

  it("オープン PR では期間末日のレビューを品質確認として扱う", () => {
    const openPull: PreparedPull = {
      ...basePull,
      outcome: { kind: "open" },
      reviews: [review(bob, "APPROVED", true, "2026-07-31T23:59:59Z")],
    };

    expect(
      calculateImplementationReviewAssurance(openPull, rangeEnd),
    ).toMatchObject({
      type: "approved",
      creditRatio: 1,
    });
  });

  it("オープン PR では期間末より後のレビューを品質確認として扱わない", () => {
    const openPull: PreparedPull = {
      ...basePull,
      outcome: { kind: "open" },
      reviews: [review(bob, "APPROVED", true, "2026-08-01T00:00:00Z")],
      reviewThreads: [
        {
          actor: bob,
          createdAt: "2026-08-01T00:00:00Z",
        },
      ],
    };

    expect(
      calculateImplementationReviewAssurance(openPull, rangeEnd),
    ).toMatchObject({
      type: "unreviewed",
      creditRatio: 0,
    });
  });

  it("未マージ PR に品質確認がなければ実装枠を配分しない", () => {
    const openPull: PreparedPull = {
      ...basePull,
      outcome: { kind: "open" },
      reviews: [],
    };

    expect(
      calculateImplementationReviewAssurance(openPull, rangeEnd),
    ).toMatchObject({
      type: "unreviewed",
      creditRatio: 0,
    });
  });
});

describe("calculateConventionalBonus", () => {
  it("feat と fix を同じ 1 点にする", () => {
    expect(calculateConventionalBonus("feat: 機能追加", "", [])).toBe(1);
    expect(calculateConventionalBonus("fix: 不具合修正", "", [])).toBe(1);
  });

  it("破壊的変更を 1.5 点にする", () => {
    expect(calculateConventionalBonus("build!: 更新", "", [])).toBe(1.5);
  });

  it("不明な形式を 0.5 点にする", () => {
    expect(calculateConventionalBonus("依存関係を更新", "", [])).toBe(0.5);
  });
});

describe("calculateStandaloneIssueScore", () => {
  it("独立 Issue を提案式で計算する", () => {
    const score = calculateStandaloneIssueScore(2, 2, 3, 1);

    expect(score).toBeCloseTo(5.75, 2);
  });

  it("8 点を上限にする", () => {
    expect(calculateStandaloneIssueScore(2, 10, 100, 100)).toBe(8);
  });
});

describe("totalAllocations", () => {
  it("大文字小文字だけが異なる GitHub ログインを同一人物としてまとめる", () => {
    const allocations: ScoreAllocation[] = [
      allocation("Hiroshiba", 1),
      allocation("hiroshiba", 2),
    ];

    const grouped = totalAllocations([], allocations);

    expect([...grouped.keys()]).toEqual(["hiroshiba"]);
    expect(grouped.get("hiroshiba")).toHaveLength(2);
  });
});

describe("contributionKinds", () => {
  it("点数内訳の種類を共通の順序で定義する", () => {
    expect(contributionKinds).toEqual([
      "implementation",
      "review",
      "issue",
    ]);
  });
});

function allocation(login: string, points: number): ScoreAllocation {
  return {
    id: "allocation:" + login,
    actor: {
      login,
      avatarUrl: "https://github.com/" + login + ".png",
    },
    kind: "issue",
    points,
    source: {
      type: "issue",
      key: "voicevox/voicevox#1",
    },
    sourceTitle: "Issue 1",
    reason: "検証",
  };
}

function actor(login: string): Actor {
  return {
    login,
    avatarUrl: "https://github.com/" + login + ".png",
  };
}

function review(
  reviewer: Actor,
  state: PreparedPull["reviews"][number]["state"],
  hasSubstantiveSummary: boolean,
  submittedAt: string,
): PreparedPull["reviews"][number] {
  return {
    actor: reviewer,
    submittedAt,
    state,
    hasSubstantiveSummary,
  };
}

function calculateMergedReviewAssurance(
  pull: PreparedMergedPull,
): ReturnType<typeof calculateImplementationReviewAssurance> {
  return calculateImplementationReviewAssurance(pull, rangeEnd);
}
