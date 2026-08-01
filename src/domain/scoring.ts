import { UnreachableError } from "./errors";
import type {
  FileScore,
  ScoreAllocation,
  WorkstreamScore,
} from "./model";

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
export function calculateFileScore(change: FileChange): FileScore {
  const generated = generatedPathPatterns.some((pattern) =>
    pattern.test(change.filename),
  );
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
    const current = grouped.get(allocation.actor.login) ?? [];
    current.push(allocation);
    grouped.set(allocation.actor.login, current);
  }
  return grouped;
}

/** 貢献種別を日本語表示へ変換する。 */
export function contributionKindLabel(
  kind: ScoreAllocation["kind"],
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
