import { UnreachableError } from "./errors.ts";
import type {
  ContributionKind,
  EditGroup,
  FileScore,
  PullEditContribution,
  PreparedPull,
  PullOutcome,
  ScoreAllocation,
  UnmeasuredReason,
  WorkstreamScore,
} from "./model.ts";

export const contributionKinds = [
  "implementation",
  "review",
  "issue",
] satisfies ContributionKind[];

export interface ImportanceInput {
  editAmount: number;
  generatedContribution: number;
  repositoryCount: number;
  conventionalBonus: number;
}

export interface EditMeasurementSummary {
  uncompressedEditAmount: number;
  editAmount: number;
  generatedFileCount: number;
  unmeasuredFileCount: number;
  unmeasuredReasons: Record<UnmeasuredReason, number>;
}

type ImplementationReviewAssurance =
  | {
      type: "approved";
      creditRatio: 1;
      label: string;
    }
  | {
      type: "substantiveReview";
      creditRatio: 1;
      label: string;
    }
  | {
      type: "independentMerge";
      creditRatio: 1;
      label: string;
    }
  | {
      type: "unreviewed";
      creditRatio: 0 | 0.5;
      label: string;
    };

type ImplementationStateCredit =
  | {
      type: "merged";
      creditRatio: 1;
      label: string;
    }
  | {
      type: "open";
      creditRatio: 0.5;
      label: string;
    }
  | {
      type: "closed";
      creditRatio: 0.25;
      label: string;
    };

type AiActivityCredit =
  | {
      type: "human";
      creditRatio: 1;
      label: string;
    }
  | {
      type: "ai";
      creditRatio: 0.3;
      label: string;
    };

/** 編集グループの反復を圧縮した編集量を計算する。 */
export function calculateEditGroupAmount(group: EditGroup): number {
  assertEditGroupValues(group);
  const tokenAmount = Math.max(
    1,
    Math.max(group.beforeTokens, group.afterTokens) / 8,
  );
  return (
    group.weight *
    tokenAmount *
    (1 + 0.25 * Math.log2(group.occurrences))
  );
}

/** 編集グループの反復を圧縮しない編集量を計算する。 */
export function calculateUncompressedEditGroupAmount(
  group: EditGroup,
): number {
  assertEditGroupValues(group);
  const tokenAmount = Math.max(
    1,
    Math.max(group.beforeTokens, group.afterTokens) / 8,
  );
  return group.weight * tokenAmount * group.occurrences;
}

/** PR ごとの編集寄与量比率を計算する。 */
export function calculatePullEditContributionRatios(
  contributions: PullEditContribution[],
): Map<string, number> {
  if (contributions.length === 0) {
    throw new Error("ワークストリームの PR 編集寄与量がありません。");
  }
  const contributionByPull = new Map<string, number>();
  for (const contribution of contributions) {
    if (
      contributionByPull.has(contribution.pullKey) ||
      Number.isFinite(contribution.amount) === false ||
      contribution.amount < 0
    ) {
      throw new Error(
        contribution.pullKey + " の PR 編集寄与量が不正です。",
      );
    }
    contributionByPull.set(contribution.pullKey, contribution.amount);
  }
  const totalAmount = [...contributionByPull.values()].reduce(
    (total, amount) => total + amount,
    0,
  );
  if (Number.isFinite(totalAmount) === false) {
    throw new Error("ワークストリームの PR 編集寄与量合計が不正です。");
  }
  const equalRatio = 1 / contributionByPull.size;
  return new Map(
    [...contributionByPull.entries()].map(([pullKey, amount]) => [
      pullKey,
      totalAmount === 0 ? equalRatio : amount / totalAmount,
    ]),
  );
}

function assertEditGroupValues(group: EditGroup): void {
  if (
    Number.isInteger(group.beforeTokens) === false ||
    group.beforeTokens < 0 ||
    Number.isInteger(group.afterTokens) === false ||
    group.afterTokens < 0 ||
    Number.isInteger(group.occurrences) === false ||
    group.occurrences <= 0
  ) {
    throw new Error("編集グループのトークン数または出現回数が不正です。");
  }
}

/** ファイル群の編集量、生成物、未測定件数を集計する。 */
export function calculateEditMeasurementSummary(
  files: FileScore[],
): EditMeasurementSummary {
  const groups = new Map<string, EditGroup>();
  const unmeasuredReasons = createUnmeasuredReasonCounts();
  let uncompressedEditAmount = 0;
  let generatedFileCount = 0;
  let unmeasuredFileCount = 0;
  for (const file of files) {
    switch (file.analysis.kind) {
      case "measured":
        for (const group of file.analysis.groups) {
          uncompressedEditAmount += calculateUncompressedEditGroupAmount(group);
          const current = groups.get(group.fingerprint);
          if (current == null) {
            groups.set(group.fingerprint, group);
            continue;
          }
          if (
            current.beforeTokens !== group.beforeTokens ||
            current.afterTokens !== group.afterTokens ||
            current.weight !== group.weight
          ) {
            throw new Error(
              "編集グループ " + group.fingerprint + " の属性が一致しません。",
            );
          }
          groups.set(group.fingerprint, {
            ...current,
            occurrences: current.occurrences + group.occurrences,
          });
        }
        break;
      case "generated":
        generatedFileCount += 1;
        break;
      case "unmeasured":
        unmeasuredFileCount += 1;
        unmeasuredReasons[file.analysis.reason] += 1;
        break;
      default:
        throw new UnreachableError(file.analysis);
    }
  }
  return {
    uncompressedEditAmount,
    editAmount: [...groups.values()].reduce(
      (total, group) => total + calculateEditGroupAmount(group),
      0,
    ),
    generatedFileCount,
    unmeasuredFileCount,
    unmeasuredReasons,
  };
}

function createUnmeasuredReasonCounts(): Record<UnmeasuredReason, number> {
  return {
    patchMissing: 0,
    patchTruncated: 0,
    binary: 0,
    unsupported: 0,
  };
}

/** ワークストリームの重要度を計算する。 */
export function calculateImportance(input: ImportanceInput): number {
  return Math.min(
    15,
    1 +
      1.5 * Math.log2(
        1 + (input.editAmount + input.generatedContribution) / 10,
      ) +
      Math.log2(input.repositoryCount) +
      input.conventionalBonus,
  );
}

/** 選択期間の末日時点における PR の状態を求める。 */
export function resolvePullOutcomeAtRangeEnd(
  outcome: PullOutcome,
  rangeEnd: string,
): PullOutcome {
  switch (outcome.kind) {
    case "merged":
      return outcome.mergedAt.slice(0, 10) <= rangeEnd
        ? outcome
        : { kind: "open" };
    case "closed":
      return outcome.closedAt.slice(0, 10) <= rangeEnd
        ? outcome
        : { kind: "open" };
    case "open":
      return outcome;
    default:
      throw new UnreachableError(outcome);
  }
}

/** PR の状態に応じた配点対象日を求める。 */
export function getPullScoringDate(
  createdAt: string,
  outcome: PullOutcome,
): string {
  switch (outcome.kind) {
    case "merged":
      return outcome.mergedAt;
    case "closed":
      return outcome.closedAt;
    case "open":
      return createdAt;
    default:
      throw new UnreachableError(outcome);
  }
}

/** AI 由来かどうかに応じた活動枠の配分率を決める。 */
export function calculateAiActivityCredit(
  isAiDerived: boolean,
): AiActivityCredit {
  if (isAiDerived) {
    return {
      type: "ai",
      creditRatio: 0.3,
      label: "AI 由来の活動",
    };
  }
  return {
    type: "human",
    creditRatio: 1,
    label: "通常の活動",
  };
}

/** PR の状態に応じた実装枠の配分率を決める。 */
export function calculateImplementationStateCredit(
  outcome: PullOutcome,
): ImplementationStateCredit {
  switch (outcome.kind) {
    case "merged":
      return {
        type: "merged",
        creditRatio: 1,
        label: "マージ済み",
      };
    case "open":
      return {
        type: "open",
        creditRatio: 0.5,
        label: "オープン",
      };
    case "closed":
      return {
        type: "closed",
        creditRatio: 0.25,
        label: "クローズ済み",
      };
    default:
      throw new UnreachableError(outcome);
  }
}

/** PR の独立したレビュー保証と実装枠の配分率を決める。 */
export function calculateImplementationReviewAssurance(
  pull: PreparedPull,
  rangeEnd: string,
): ImplementationReviewAssurance {
  const outcome = pull.outcome;
  const authorLogin = pull.author.login.toLowerCase();
  const isIndependent = (login: string): boolean =>
    login.toLowerCase() !== authorLogin;
  const independentReviews = pull.reviews.filter(
    (review) =>
      isTimestampWithinPullOutcome(review.submittedAt, outcome, rangeEnd) &&
      isIndependent(review.actor.login),
  );
  const hasApproval = independentReviews.some(
    (review) => review.state === "APPROVED",
  );
  const hasSubstantiveReview =
    independentReviews.some((review) => review.hasSubstantiveSummary) ||
    pull.reviewThreads.some(
      (thread) =>
        isTimestampWithinPullOutcome(thread.createdAt, outcome, rangeEnd) &&
        isIndependent(thread.actor.login),
    );
  const hasIndependentMerger =
    outcome.kind === "merged" &&
    outcome.mergedByIsHuman &&
    isIndependent(outcome.mergedBy.login);

  if (hasApproval) {
    return {
      type: "approved",
      creditRatio: 1,
      label: "作者以外の人間による承認あり",
    };
  }
  if (hasSubstantiveReview) {
    return {
      type: "substantiveReview",
      creditRatio: 1,
      label: "作者以外の人間による実質レビューあり",
    };
  }
  if (hasIndependentMerger) {
    return {
      type: "independentMerge",
      creditRatio: 1,
      label: "作者以外の人間によるマージ",
    };
  }
  return {
    type: "unreviewed",
    creditRatio: outcome.kind === "merged" ? 0.5 : 0,
    label: "独立した品質確認なし",
  };
}

function isTimestampWithinPullOutcome(
  timestamp: string,
  outcome: PullOutcome,
  rangeEnd: string,
): boolean {
  switch (outcome.kind) {
    case "merged":
      return isTimestampAtOrBefore(timestamp, outcome.mergedAt);
    case "closed":
      return isTimestampAtOrBefore(timestamp, outcome.closedAt);
    case "open":
      return isTimestampAtOrBefore(
        timestamp,
        rangeEnd + "T23:59:59.999Z",
      );
    default:
      throw new UnreachableError(outcome);
  }
}

function isTimestampAtOrBefore(timestamp: string, end: string): boolean {
  const timestampValue = Date.parse(timestamp);
  const endValue = Date.parse(end);
  if (Number.isNaN(timestampValue) || Number.isNaN(endValue)) {
    throw new Error("レビュー保証の日時を解釈できません。");
  }
  return timestampValue <= endValue;
}

/** PR の最終タイトルと本文から Conventional Commits 補正を決める。 */
export function calculateConventionalBonus(
  title: string,
  body: string,
  labels: string[],
): number {
  const breaking =
    /^[a-z]+(?:\([^)]+\))?!:/i.test(title) ||
    /BREAKING[ -]CHANGE/i.test(body) ||
    /(?:security|セキュリティ|CVE-\d{4}-\d+)/i.test(
      title + "\n" + body + "\n" + labels.join("\n"),
    );
  if (breaking) {
    return 1.5;
  }

  const match = /^([a-z]+)(?:\([^)]+\))?:/i.exec(title);
  const type = match?.[1]?.toLowerCase();
  if (type == null) {
    return 0.5;
  }

  switch (type) {
    case "feat":
    case "fix":
    case "perf":
      return 1;
    case "style":
      return 0.25;
    case "test":
    case "build":
    case "ci":
    case "refactor":
    case "docs":
    case "chore":
    case "revert":
      return 0.5;
    default:
      return 0.5;
  }
}

/** 独立 Issue の成果点を計算する。 */
export function calculateStandaloneIssueScore(
  statusBonus: number,
  evidenceCount: number,
  substantiveCommentCount: number,
  participantCount: number,
): number {
  return Math.min(
    8,
    statusBonus +
      0.5 * Math.min(evidenceCount, 4) +
      Math.min(3, Math.log2(1 + substantiveCommentCount)) +
      Math.min(1.5, 0.75 * Math.log2(1 + participantCount)),
  );
}

/** 配点を貢献者ごとの合計へ変換する。 */
export function totalAllocations(
  workstreams: WorkstreamScore[],
  standaloneAllocations: ScoreAllocation[],
): Map<string, ScoreAllocation[]> {
  const grouped = new Map<string, ScoreAllocation[]>();
  const allocations = [
    ...workstreams.flatMap((workstream) => workstream.allocations),
    ...standaloneAllocations,
  ];

  for (const allocation of allocations) {
    const key = allocation.actor.login.toLowerCase();
    const current = grouped.get(key) ?? [];
    current.push(allocation);
    grouped.set(key, current);
  }
  return grouped;
}

/** 貢献種別を日本語表示へ変換する。 */
export function contributionKindLabel(
  kind: ContributionKind,
): string {
  switch (kind) {
    case "implementation":
      return "実装";
    case "review":
      return "レビュー";
    case "issue":
      return "Issue・調査";
    default:
      throw new UnreachableError(kind);
  }
}
