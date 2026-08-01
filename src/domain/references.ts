import { assertNonNullable } from "./errors.ts";

export type ReferenceHint = "issue" | "pull" | "unknown";

export interface GithubReference {
  owner: string;
  repository: string;
  number: number;
  hint: ReferenceHint;
}

interface IndexedReference {
  index: number;
  reference: GithubReference;
}

/** GitHub の Issue または PR 参照を出現順に抽出する。 */
export function extractGithubReferences(
  text: string,
  localOwner: string,
  localRepository: string,
): GithubReference[] {
  const searchableText = maskIgnoredMarkdown(text);
  const indexed: IndexedReference[] = [];

  for (const match of searchableText.matchAll(
    /https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(issues|pull)\/([1-9]\d*)/gi,
  )) {
    const owner = match[1];
    const repository = match[2];
    const kind = match[3];
    const numberText = match[4];
    assertNonNullable(owner, "GitHub 参照の owner を取得できません。");
    assertNonNullable(repository, "GitHub 参照のリポジトリを取得できません。");
    assertNonNullable(kind, "GitHub 参照の種別を取得できません。");
    assertNonNullable(numberText, "GitHub 参照の番号を取得できません。");
    indexed.push({
      index: requireMatchIndex(match),
      reference: {
        owner,
        repository,
        number: parseReferenceNumber(numberText),
        hint: kind === "pull" ? "pull" : "issue",
      },
    });
  }

  for (const match of searchableText.matchAll(
    /\b([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#([1-9]\d*)\b/g,
  )) {
    const owner = match[1];
    const repository = match[2];
    const numberText = match[3];
    assertNonNullable(owner, "GitHub 参照の owner を取得できません。");
    assertNonNullable(repository, "GitHub 参照のリポジトリを取得できません。");
    assertNonNullable(numberText, "GitHub 参照の番号を取得できません。");
    indexed.push({
      index: requireMatchIndex(match),
      reference: {
        owner,
        repository,
        number: parseReferenceNumber(numberText),
        hint: "unknown",
      },
    });
  }

  for (const match of searchableText.matchAll(/(^|[^\w/])#([1-9]\d*)\b/g)) {
    const prefix = match[1];
    const numberText = match[2];
    assertNonNullable(prefix, "GitHub 参照の接頭辞を取得できません。");
    assertNonNullable(numberText, "GitHub 参照の番号を取得できません。");
    indexed.push({
      index: requireMatchIndex(match) + prefix.length,
      reference: {
        owner: localOwner,
        repository: localRepository,
        number: parseReferenceNumber(numberText),
        hint: "unknown",
      },
    });
  }

  indexed.sort((left, right) => left.index - right.index);
  const seen = new Set<string>();
  return indexed
    .filter(({ reference }) => {
      const key =
        reference.owner.toLowerCase() +
        "/" +
        reference.repository.toLowerCase() +
        "#" +
        reference.number;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map(({ reference }) => reference);
}

/** Closing keyword の後にある Issue 参照を抽出する。 */
export function extractClosingReferences(
  body: string,
  localOwner: string,
  localRepository: string,
): GithubReference[] {
  const searchableBody = maskIgnoredMarkdown(body);
  const references: GithubReference[] = [];
  for (const match of searchableBody.matchAll(
    /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+/gi,
  )) {
    const index = requireMatchIndex(match) + match[0].length;
    const lineEnd = searchableBody.indexOf("\n", index);
    const remainder =
      lineEnd === -1
        ? searchableBody.slice(index)
        : searchableBody.slice(index, lineEnd);
    const first = extractGithubReferences(
      remainder,
      localOwner,
      localRepository,
    )[0];
    if (first != null) {
      references.push(first);
    }
  }
  return uniqueReferences(references);
}

/** 関連 Issue セクションにある参照を抽出する。 */
export function extractRelatedIssueReferences(
  body: string,
  localOwner: string,
  localRepository: string,
): GithubReference[] {
  const lines = maskIgnoredMarkdown(body).split("\n");
  const sectionLines: string[] = [];
  let inSection = false;

  for (const line of lines) {
    if (/^#{1,6}\s*(?:関連\s*Issue|Related\s+Issues?)\s*$/i.test(line.trim())) {
      inSection = true;
      continue;
    }
    if (inSection && /^#{1,6}\s+/.test(line)) {
      break;
    }
    if (inSection) {
      sectionLines.push(line);
    }
  }

  return extractGithubReferences(
    sectionLines.join("\n"),
    localOwner,
    localRepository,
  );
}

function uniqueReferences(references: GithubReference[]): GithubReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key =
      reference.owner.toLowerCase() +
      "/" +
      reference.repository.toLowerCase() +
      "#" +
      reference.number;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function parseReferenceNumber(value: string): number {
  const number = Number(value);
  if (Number.isSafeInteger(number) === false || number <= 0) {
    throw new Error("GitHub 参照の番号が安全な正の整数ではありません。");
  }
  return number;
}

function maskIgnoredMarkdown(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, maskText)
    .replace(/```[\s\S]*?```/g, maskText)
    .replace(/~~~[\s\S]*?~~~/g, maskText)
    .replace(/`[^`\n]*`/g, maskText);
}

function maskText(text: string): string {
  return text.replace(/[^\n]/g, " ");
}

function requireMatchIndex(match: RegExpMatchArray): number {
  const index = match.index;
  assertNonNullable(index, "正規表現の一致位置を取得できません。");
  return index;
}
