import { UnreachableError } from "./errors.ts";
import type {
  ContributionKind,
  FileScore,
  PreparedMergedPull,
  PreparedPull,
  ScoreAllocation,
  WorkstreamScore,
} from "./model.ts";

export const contributionKinds = [
  "implementation",
  "review",
  "issue",
] satisfies ContributionKind[];

export interface FileChange {
  filename: string;
  additions: number;
  deletions: number;
}

export interface ImportanceInput {
  effectiveLines: number;
  nonGeneratedFiles: number;
  repositoryCount: number;
  conventionalBonus: number;
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
      creditRatio: 0.5;
      label: string;
    };

type FullAiImplementationCredit =
  | {
      type: "human";
      creditRatio: 1;
      label: string;
    }
  | {
      type: "fullAi";
      creditRatio: 0.3;
      label: string;
    };

const generatedPathPatterns = [
  /(?:^|\/)(?:vendor|vendors|third_party|node_modules|dist|generated)(?:\/|$)/i,
  /(?:^|\/)(?:__snapshots__|snapshots?)(?:\/|$)/i,
  /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|uv\.lock|Cargo\.lock)$/i,
  /(?:^|\/)[^/]+\.lock$/i,
  /(?:\.generated\.|\.snap$|\.snapshot$|\.min\.(?:js|css)$|\.map$)/i,
];

const documentationPathPattern =
  /(?:\.mdx?|\.rst|\.adoc|\.asciidoc|\.txt)$/i;

/** ファイル変更から有効変更行数を計算する。 */
export function calculateFileScore(
  change: FileChange,
  fullAiImplementation: boolean,
): FileScore {
  const generated =
    fullAiImplementation ||
    generatedPathPatterns.some((pattern) => pattern.test(change.filename));
  const documentation = documentationPathPattern.test(change.filename);
  const factor = generated ? 0.05 : documentation ? 0.5 : 1;
  const changedLines = Math.min(200, change.additions + change.deletions);

  return {
    ...change,
    effectiveLines: changedLines * factor,
    generated,
  };
}

/** PR の実装枠を分けるための質量を計算する。 */
export function calculatePullMass(
  effectiveLines: number,
  nonGeneratedFiles: number,
): number {
  return (
    1 +
    Math.log2(1 + effectiveLines / 20) +
    0.5 * Math.log2(1 + nonGeneratedFiles)
  );
}

/** ワークストリームの重要度を計算する。 */
export function calculateImportance(input: ImportanceInput): number {
  return Math.min(
    15,
    1 +
      1.5 * Math.log2(1 + input.effectiveLines / 20) +
      0.5 * Math.log2(1 + input.nonGeneratedFiles) +
      Math.log2(input.repositoryCount) +
      input.conventionalBonus,
  );
}

/** PR の実装体制と実装枠の配分率を決める。 */
export function calculateFullAiImplementationCredit(
  pull: PreparedPull,
): FullAiImplementationCredit {
  if (pull.fullAiImplementation) {
    return {
      type: "fullAi",
      creditRatio: 0.3,
      label: "フルAI実装リポジトリ",
    };
  }
  return {
    type: "human",
    creditRatio: 1,
    label: "人間が実装するリポジトリ",
  };
}

/** PR の独立したレビュー保証と実装枠の配分率を決める。 */
export function calculateImplementationReviewAssurance(
  pull: PreparedMergedPull,
): ImplementationReviewAssurance {
  const outcome = pull.outcome;
  const authorLogin = pull.author.login.toLowerCase();
  const isIndependent = (login: string): boolean =>
    login.toLowerCase() !== authorLogin;
  const independentReviews = pull.reviews.filter(
    (review) =>
      isTimestampAtOrBefore(review.submittedAt, outcome.mergedAt) &&
      isIndependent(review.actor.login),
  );
  const hasApproval = independentReviews.some(
    (review) => review.state === "APPROVED",
  );
  const hasSubstantiveReview =
    independentReviews.some((review) => review.hasSubstantiveSummary) ||
    pull.reviewThreads.some(
      (thread) =>
        isTimestampAtOrBefore(thread.createdAt, outcome.mergedAt) &&
        isIndependent(thread.actor.login),
    );
  const hasIndependentMerger =
    outcome.mergedByIsHuman && isIndependent(outcome.mergedBy.login);

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
    creditRatio: 0.5,
    label: "独立した品質確認なし",
  };
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
