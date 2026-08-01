import type { EvidenceKind } from "./model.ts";

const evidencePatterns: ReadonlyArray<{
  kind: EvidenceKind;
  pattern: RegExp;
}> = [
  {
    kind: "codeOrLog",
    pattern:
      /\x60{3}[\s\S]+?\x60{3}|(?:^|\n)(?:error|fatal|traceback|exception|stack trace|ログ)[：:]?/im,
  },
  {
    kind: "command",
    pattern:
      /(?:^|\n)\s*(?:\$|>|pnpm |npm |uv |cargo |git |docker |python |node |curl )[^\n]+/im,
  },
  {
    kind: "attachment",
    pattern:
      /https:\/\/(?:github\.com\/user-attachments\/assets|user-images\.githubusercontent\.com)\/|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\.(?:wav|mp3|ogg|zip|log|png|jpe?g|webp|pdf)(?:\?[^)]*)?\)/i,
  },
  {
    kind: "reference",
    pattern:
      /(?:https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/(?:issues|pull|commit|actions\/runs)\/\d+|\b[\w.-]+\/[\w.-]+#\d+|\b(?:commit|upstream|actions? run)\b)/i,
  },
  {
    kind: "environment",
    pattern:
      /\b(?:Windows|macOS|Ubuntu|Linux|Debian|Fedora|Arch|WSL|Chrome|Firefox|Safari|Node(?:\.js)?|Python|CUDA|cuDNN)\b|(?:バージョン|version|環境)[：:]?\s*v?\d+[.\d-]*/i,
  },
  {
    kind: "measurement",
    pattern:
      /(?:^|\n)\s*\|[^\n]+\|\s*(?:\n|$)|\b\d+(?:\.\d+)?\s*(?:ms|sec|秒|分|時間|KB|MB|GB|MiB|GiB|%|倍|回|件|話者)\b|(?:平均|中央値|ベンチマーク|処理時間|容量)[：:]?\s*\d/i,
  },
];

const boilerplatePatterns = [
  /<!--[^]*?-->/g,
  /(?:^|\n)>[^\n]*/g,
  /(?:^|\n)\s*[-*]\s*\[[ xX]\]\s*[^\n]*/g,
];

/** 本文から検証可能な証拠要素の種類を抽出する。 */
export function detectEvidenceKinds(text: string): EvidenceKind[] {
  return evidencePatterns
    .filter(({ pattern }) => pattern.test(text))
    .map(({ kind }) => kind);
}

/** 引用やテンプレートを除いた本文を返す。 */
export function normalizeContributionText(text: string): string {
  return boilerplatePatterns
    .reduce((normalized, pattern) => normalized.replace(pattern, "\n"), text)
    .replace(/\s+/g, " ")
    .trim();
}

/** Issue の本文やコメントが実質的かを判定する。 */
export function isSubstantiveIssueText(text: string): boolean {
  return (
    normalizeContributionText(text).length >= 80 ||
    detectEvidenceKinds(text).length > 0
  );
}

/** レビュー本文が具体的な内容を持つかを判定する。 */
export function isSubstantiveReviewText(text: string): boolean {
  const normalized = normalizeContributionText(text);
  const acknowledgement =
    /^(?:LGTM|OK|approve|承認|確認しました|ありがとうございます|修正しました)[!！。\s]*$/i;
  return (
    acknowledgement.test(normalized) === false &&
    (normalized.length >= 20 || detectEvidenceKinds(text).length > 0)
  );
}
