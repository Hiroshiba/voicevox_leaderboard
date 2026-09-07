import { createHash } from "node:crypto";
import { diffArrays } from "diff";
import type { ArrayChange } from "diff";
import { assertNonNullable } from "../src/domain/errors.ts";
import type {
  EditGroup,
  FileAnalysis,
  FileScore,
} from "../src/domain/model.ts";

interface FileChangeInput {
  filename: string;
  additions: number;
  deletions: number;
  patch?: string | undefined;
  previousFilename?: string | undefined;
  sha?: string | undefined;
}

type LexicalMode =
  | "javascript"
  | "python"
  | "yaml"
  | "shell"
  | "vue"
  | "astro"
  | "css"
  | "document"
  | "generic";

type TokenKind =
  | "comment"
  | "identifier"
  | "number"
  | "operator"
  | "stringDelimiter"
  | "stringEscape"
  | "stringIdentifier"
  | "stringNumber"
  | "stringPunctuation"
  | "stringWhitespace"
  | "indent"
  | "whitespace"
  | "newline";

interface Token {
  kind: TokenKind;
  text: string;
  key: string;
}

interface Hunk {
  oldLines: string[];
  newLines: string[];
}

interface MutableHunk extends Hunk {
  oldCount: number;
  newCount: number;
}

const maxPatchCharacters = 2_000_000;
const maxTokensPerSide = 100_000;
const maxEditLength = 20_000;

const generatedPathPatterns = [
  /(?:^|\/)(?:vendor|vendors|third_party|node_modules|dist|generated)(?:\/|$)/i,
  /(?:^|\/)(?:__snapshots__|snapshots?)(?:\/|$)/i,
  /(?:^|\/)[^/]*-snapshots(?:\/|$)/i,
  /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|uv\.lock|Cargo\.lock)$/i,
  /(?:^|\/)[^/]+\.lock$/i,
  /(?:\.generated\.|\.snap$|\.snapshot$|\.min\.(?:js|css)$|\.map$)/i,
];

const documentationPathPattern =
  /(?:\.mdx?|\.rst|\.adoc|\.asciidoc|\.txt)$/i;

const binaryExtensions = new Set([
  "7z",
  "a",
  "ambr",
  "avi",
  "bin",
  "class",
  "dll",
  "dmg",
  "eot",
  "exe",
  "gif",
  "ico",
  "jar",
  "jpeg",
  "jpg",
  "m4a",
  "mp3",
  "mp4",
  "onnx",
  "otf",
  "pdf",
  "png",
  "so",
  "tar",
  "tgz",
  "tif",
  "tiff",
  "wav",
  "webm",
  "webp",
  "woff",
  "woff2",
  "vvm",
  "zip",
]);

const multiCharacterOperators = [
  "===",
  "!==",
  "++",
  "--",
  ">>>=",
  "**=",
  "&&=",
  "||=",
  "??=",
  "<<=",
  ">>=",
  "...",
  ">>>",
  "=>",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "??",
  "?.",
  "**",
  "//",
  "::",
  ":=",
  "<<",
  ">>",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "->",
];

const regexAfterKeywords = new Set([
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);

const hunkHeaderPattern =
  /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/;

class PatchTruncatedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchTruncatedError";
  }
}

class UnsupportedDiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedDiffError";
  }
}

/** GitHub の変更ファイル patch から字句編集量を算定する。 */
export function analyzeFileChange(
  change: FileChangeInput,
  fullAiImplementation: boolean,
): FileScore {
  validateFileChange(change);

  if (
    fullAiImplementation ||
    generatedPathPatterns.some((pattern) => pattern.test(change.filename))
  ) {
    return createFileScore(change, { kind: "generated" });
  }

  if (isKnownBinary(change.filename)) {
    return createFileScore(change, {
      kind: "unmeasured",
      reason: "binary",
    });
  }

  if (change.previousFilename != null) {
    return createFileScore(change, {
      kind: "unmeasured",
      reason: "unsupported",
    });
  }

  const patch = change.patch;
  if (patch == null) {
    return createFileScore(change, {
      kind: "unmeasured",
      reason: "patchMissing",
    });
  }
  if (/^Binary files .* differ$/m.test(patch)) {
    return createFileScore(change, {
      kind: "unmeasured",
      reason: "binary",
    });
  }

  try {
    const hunks = parsePatch(patch, change.additions, change.deletions);
    const groups = analyzeHunks(
      hunks,
      getLexicalMode(change.filename),
      documentationPathPattern.test(change.filename) ? 0.5 : 1,
    );
    return createFileScore(change, { kind: "measured", groups });
  } catch (error) {
    if (error instanceof PatchTruncatedError) {
      return createFileScore(change, {
        kind: "unmeasured",
        reason: "patchTruncated",
      });
    }
    if (error instanceof UnsupportedDiffError) {
      return createFileScore(change, {
        kind: "unmeasured",
        reason: "unsupported",
      });
    }
    throw error;
  }
}

function validateFileChange(change: FileChangeInput): void {
  if (change.filename.length === 0) {
    throw new Error("変更ファイルの名前が空です。");
  }
  if (
    Number.isSafeInteger(change.additions) === false ||
    change.additions < 0 ||
    Number.isSafeInteger(change.deletions) === false ||
    change.deletions < 0
  ) {
    throw new Error("変更行数は 0 以上の安全な整数で指定してください。");
  }
  if (
    change.previousFilename != null &&
    change.previousFilename.length === 0
  ) {
    throw new Error("変更前ファイルの名前が空です。");
  }
}

function createFileScore(
  change: FileChangeInput,
  analysis: FileAnalysis,
): FileScore {
  return {
    filename: change.filename,
    additions: change.additions,
    deletions: change.deletions,
    ...(change.previousFilename == null
      ? {}
      : { previousFilename: change.previousFilename }),
    ...(change.sha == null ? {} : { sha: change.sha }),
    analysis,
  };
}

function isKnownBinary(filename: string): boolean {
  const basename = filename.slice(filename.lastIndexOf("/") + 1);
  const dotIndex = basename.lastIndexOf(".");
  if (dotIndex <= 0) {
    return false;
  }
  const extension = basename.slice(dotIndex + 1).toLowerCase();
  return binaryExtensions.has(extension);
}

function parsePatch(
  patch: string,
  expectedAdditions: number,
  expectedDeletions: number,
): Hunk[] {
  if (patch.length > maxPatchCharacters) {
    throw new UnsupportedDiffError("patch が大きすぎます。");
  }

  const lines = patch.split("\n");
  if (patch.endsWith("\n")) {
    lines.pop();
  }
  const hunks: Hunk[] = [];
  let current: MutableHunk | undefined;
  let additions = 0;
  let deletions = 0;

  for (const rawLine of lines) {
    const line = rawLine.endsWith("\r")
      ? rawLine.slice(0, rawLine.length - 1)
      : rawLine;
    if (line.startsWith("@@")) {
      if (hunkHeaderPattern.test(line) === false) {
        throw new UnsupportedDiffError("patch の hunk header を解釈できません。");
      }
      if (current != null) {
        finishHunk(current, hunks);
      }
      const match = hunkHeaderPattern.exec(line);
      if (match == null) {
        throw new UnsupportedDiffError("patch の hunk header を解釈できません。");
      }
      current = {
        oldLines: [],
        newLines: [],
        oldCount: parseHunkCount(match[2]),
        newCount: parseHunkCount(match[4]),
      };
      continue;
    }

    if (current == null) {
      if (isPatchMetadataLine(line)) {
        continue;
      }
      throw new UnsupportedDiffError("patch のメタデータを解釈できません。");
    }
    if (line === "\\ No newline at end of file") {
      continue;
    }

    const prefix = line[0];
    if (prefix == null) {
      throw new UnsupportedDiffError("patch の変更行を解釈できません。");
    }
    const content = line.slice(1);
    switch (prefix) {
      case " ":
        current.oldLines.push(content);
        current.newLines.push(content);
        break;
      case "+":
        current.newLines.push(content);
        additions += 1;
        break;
      case "-":
        current.oldLines.push(content);
        deletions += 1;
        break;
      default:
        throw new UnsupportedDiffError("patch の変更行を解釈できません。");
    }
  }

  if (current != null) {
    finishHunk(current, hunks);
  }
  if (hunks.length === 0) {
    throw new PatchTruncatedError("patch に hunk がありません。");
  }
  if (additions !== expectedAdditions || deletions !== expectedDeletions) {
    throw new PatchTruncatedError(
      "patch の additions と deletions が API の集計値と一致しません。",
    );
  }
  return hunks;
}

function isPatchMetadataLine(line: string): boolean {
  return [
    "diff --git ",
    "index ",
    "--- ",
    "+++ ",
    "old mode ",
    "new mode ",
    "new file mode ",
    "deleted file mode ",
    "similarity index ",
    "rename from ",
    "rename to ",
    "copy from ",
    "copy to ",
  ].some((prefix) => line.startsWith(prefix));
}

function parseHunkCount(value: string | undefined): number {
  const count = value == null ? 1 : Number(value);
  if (Number.isSafeInteger(count) === false || count < 0) {
    throw new UnsupportedDiffError("patch の hunk 行数を解釈できません。");
  }
  return count;
}

function finishHunk(current: MutableHunk, hunks: Hunk[]): void {
  if (
    current.oldLines.length !== current.oldCount ||
    current.newLines.length !== current.newCount
  ) {
    throw new PatchTruncatedError(
      "patch の hunk 行数が hunk header と一致しません。",
    );
  }
  hunks.push({
    oldLines: current.oldLines,
    newLines: current.newLines,
  });
}

function analyzeHunks(
  hunks: Hunk[],
  mode: LexicalMode,
  weight: 0.5 | 1,
): EditGroup[] {
  const grouped = new Map<string, EditGroup>();
  for (const hunk of hunks) {
    const beforeTokens = tokenize(hunk.oldLines.join("\n"), mode);
    const afterTokens = tokenize(hunk.newLines.join("\n"), mode);
    if (
      beforeTokens.length > maxTokensPerSide ||
      afterTokens.length > maxTokensPerSide
    ) {
      throw new UnsupportedDiffError("patch の字句数が上限を超えています。");
    }

    const changes: ArrayChange<Token>[] | undefined = diffArrays(
      beforeTokens,
      afterTokens,
      {
        comparator: (before, after) => before.key === after.key,
        maxEditLength,
      },
    );
    if (changes == null) {
      throw new UnsupportedDiffError("patch の字句差分が大きすぎます。");
    }

    for (let index = 0; index < changes.length; ) {
      const change: ArrayChange<Token> | undefined = changes[index];
      assertNonNullable(change, "字句差分の要素がありません。");
      if (change.added !== true && change.removed !== true) {
        index += 1;
        continue;
      }

      const before: Token[] = [];
      const after: Token[] = [];
      while (index < changes.length) {
        const edit: ArrayChange<Token> | undefined = changes[index];
        assertNonNullable(edit, "字句差分の要素がありません。");
        if (edit.added !== true && edit.removed !== true) {
          break;
        }
        if (edit.removed === true) {
          before.push(...edit.value);
        }
        if (edit.added === true) {
          after.push(...edit.value);
        }
        index += 1;
      }
      if (before.length === 0 && after.length === 0) {
        continue;
      }
      addEditGroup(grouped, before, after, weight);
    }
  }
  return [...grouped.values()].sort((left, right) =>
    left.fingerprint.localeCompare(right.fingerprint),
  );
}

function addEditGroup(
  grouped: Map<string, EditGroup>,
  before: Token[],
  after: Token[],
  weight: 0.5 | 1,
): void {
  const fingerprint = createFingerprint(weight, before, after);
  const current = grouped.get(fingerprint);
  if (current == null) {
    grouped.set(fingerprint, {
      fingerprint,
      beforeTokens: before.length,
      afterTokens: after.length,
      occurrences: 1,
      weight,
    });
    return;
  }
  grouped.set(fingerprint, {
    ...current,
    occurrences: current.occurrences + 1,
  });
}

function createFingerprint(
  weight: 0.5 | 1,
  before: Token[],
  after: Token[],
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        weight,
        before.map((token) => token.key),
        after.map((token) => token.key),
      ]),
      "utf8",
    )
    .digest("hex");
}

function getLexicalMode(filename: string): LexicalMode {
  const basename = filename.slice(filename.lastIndexOf("/") + 1);
  const lowercaseBasename = basename.toLowerCase();
  if (
    lowercaseBasename === "dockerfile" ||
    lowercaseBasename.startsWith("dockerfile.")
  ) {
    return "shell";
  }
  if (documentationPathPattern.test(filename)) {
    return "document";
  }
  const dotIndex = basename.lastIndexOf(".");
  if (dotIndex <= 0) {
    return "generic";
  }
  const extension = basename.slice(dotIndex + 1).toLowerCase();
  if (
    ["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"].includes(
      extension,
    )
  ) {
    return "javascript";
  }
  if (["py", "pyi", "pyw"].includes(extension)) {
    return "python";
  }
  if (["yaml", "yml"].includes(extension)) {
    return "yaml";
  }
  if (["sh", "bash", "zsh", "ksh", "fish"].includes(extension)) {
    return "shell";
  }
  if (extension === "vue") {
    return "vue";
  }
  if (extension === "astro") {
    return "astro";
  }
  if (["css", "scss", "sass", "less"].includes(extension)) {
    return "css";
  }
  return "generic";
}

function tokenize(text: string, mode: LexicalMode): Token[] {
  const tokens: Token[] = [];
  const preserveLineBreak =
    mode === "python" ||
    mode === "yaml" ||
    mode === "shell" ||
    mode === "javascript" ||
    mode === "vue" ||
    mode === "astro" ||
    mode === "css";
  const preserveIndent = mode === "python" || mode === "yaml";
  const preserveWhitespace =
    mode === "shell" || mode === "yaml" || mode === "css";
  let index = 0;
  let lineStart = true;
  let previousToken: Token | undefined;

  while (index < text.length) {
    const char = text[index];
    assertNonNullable(char, "字句入力の位置を取得できません。");

    if (char === "\r" || char === "\n") {
      const start = index;
      if (char === "\r" && text[index + 1] === "\n") {
        index += 2;
      } else {
        index += 1;
      }
      if (preserveLineBreak) {
        pushToken(tokens, "newline", text.slice(start, index));
      }
      lineStart = true;
      continue;
    }

    if (char === " " || char === "\t") {
      const start = index;
      while (index < text.length) {
        const whitespace = text[index];
        assertNonNullable(whitespace, "字句入力の位置を取得できません。");
        if (whitespace !== " " && whitespace !== "\t") {
          break;
        }
        index += 1;
      }
      const value = text.slice(start, index);
      if (preserveIndent && lineStart) {
        const next = text[index];
        if (next !== "\r" && next !== "\n") {
          pushToken(tokens, "indent", value);
        }
      } else if (preserveWhitespace) {
        pushToken(tokens, "whitespace", value);
      }
      continue;
    }

    const comment = getCommentDelimiter(text, index, mode, lineStart);
    if (comment != null) {
      const end = consumeComment(text, index, comment);
      pushToken(tokens, "comment", text.slice(index, end));
      index = end;
      lineStart = false;
      continue;
    }

    if (isQuoteStart(text, index, mode)) {
      const end = consumeString(text, index, mode, tokens);
      lineStart = endsAtLineStart(text.slice(index, end));
      index = end;
      previousToken = tokens[tokens.length - 1];
      continue;
    }

    if (
      mode === "javascript" &&
      char === "/" &&
      isLikelyRegexStart(previousToken)
    ) {
      const end = consumeRegex(text, index, tokens);
      lineStart = false;
      index = end;
      previousToken = tokens[tokens.length - 1];
      continue;
    }

    if (isIdentifierStart(char)) {
      const start = index;
      index += 1;
      while (index < text.length) {
        const part = text[index];
        assertNonNullable(part, "字句入力の位置を取得できません。");
        if (isIdentifierPart(part) === false) {
          break;
        }
        index += 1;
      }
      pushToken(tokens, "identifier", text.slice(start, index));
      lineStart = false;
      previousToken = tokens[tokens.length - 1];
      continue;
    }

    if (isDigit(char)) {
      const start = index;
      index += 1;
      while (index < text.length) {
        const part = text[index];
        assertNonNullable(part, "字句入力の位置を取得できません。");
        if (
          (isIdentifierPart(part) === false && part !== ".")
        ) {
          break;
        }
        index += 1;
      }
      pushToken(tokens, "number", text.slice(start, index));
      lineStart = false;
      previousToken = tokens[tokens.length - 1];
      continue;
    }

    const operator = multiCharacterOperators.find((candidate) =>
      text.startsWith(candidate, index),
    );
    const operatorText = operator ?? char;
    pushToken(tokens, "operator", operatorText);
    index += operatorText.length;
    lineStart = false;
    previousToken = tokens[tokens.length - 1];
  }
  return tokens;
}

function getCommentDelimiter(
  text: string,
  index: number,
  mode: LexicalMode,
  lineStart: boolean,
): string | undefined {
  if (mode === "document") {
    return text.startsWith("<!--", index) ? "<!--" : undefined;
  }
  if (mode === "python" || mode === "yaml" || mode === "shell") {
    if (text[index] !== "#") {
      return undefined;
    }
    if (mode === "yaml" && lineStart === false) {
      const previous = text[index - 1];
      if (
        previous != null &&
        previous !== " " &&
        previous !== "\t" &&
        previous !== "\r" &&
        previous !== "\n"
      ) {
        return undefined;
      }
    }
    if (mode === "shell" && isShellCommentStart(text, index, lineStart) === false) {
      return undefined;
    }
    return "#";
  }
  if (text.startsWith("//", index) || text.startsWith("/*", index)) {
    return text.slice(index, index + 2);
  }
  if (text.startsWith("<!--", index)) {
    return "<!--";
  }
  return undefined;
}

function isShellCommentStart(
  text: string,
  index: number,
  lineStart: boolean,
): boolean {
  if (lineStart) {
    return true;
  }
  const previous = text[index - 1];
  return (
    previous === " " ||
    previous === "\t" ||
    previous === ";" ||
    previous === "|" ||
    previous === "&" ||
    previous === "(" ||
    previous === "{" ||
    previous === ">"
  );
}

function consumeComment(text: string, index: number, delimiter: string): number {
  if (delimiter === "#" || delimiter === "//") {
    let end = index + delimiter.length;
  while (end < text.length) {
    const char = text[end];
    assertNonNullable(char, "コメント入力の位置を取得できません。");
    if (char === "\r" || char === "\n") {
        break;
      }
      end += 1;
    }
    return end;
  }
  const endDelimiter = delimiter === "/*" ? "*/" : "-->";
  const end = text.indexOf(endDelimiter, index + delimiter.length);
  if (end < 0) {
    throw new UnsupportedDiffError("閉じていないコメントがあります。");
  }
  return end + endDelimiter.length;
}

function isQuoteStart(text: string, index: number, mode: LexicalMode): boolean {
  const char = text[index];
  assertNonNullable(char, "引用符の位置を取得できません。");
  if (mode === "document") {
    return false;
  }
  if (char === "`") {
    return mode === "javascript" || mode === "vue" || mode === "astro";
  }
  if (char !== "'" && char !== '"') {
    return false;
  }
  if (char === '"') {
    return true;
  }
  const previous = text[index - 1];
  if (previous == null || isIdentifierPart(previous) === false) {
    return true;
  }
  if (mode !== "python") {
    return false;
  }
  return isPythonStringPrefixAt(text, index);
}

function isPythonStringPrefixAt(text: string, index: number): boolean {
  let prefixStart = index;
  while (prefixStart > 0) {
    const prefixCharacter = text[prefixStart - 1];
    assertNonNullable(prefixCharacter, "Python 文字列 prefix の位置を取得できません。");
    if (isIdentifierPart(prefixCharacter) === false) {
      break;
    }
    prefixStart -= 1;
  }
  const prefix = text.slice(prefixStart, index).toLowerCase();
  const prefixBoundary = text[prefixStart - 1];
  return (
    ["r", "u", "b", "f", "fr", "rf", "br", "rb"].includes(prefix) &&
    (prefixBoundary == null || isIdentifierPart(prefixBoundary) === false)
  );
}

function isLikelyRegexStart(previous: Token | undefined): boolean {
  if (previous == null) {
    return true;
  }
  if (previous.kind === "identifier") {
    return regexAfterKeywords.has(previous.text);
  }
  if (previous.kind === "number" || previous.kind === "comment") {
    return false;
  }
  if (previous.kind.startsWith("string")) {
    return false;
  }
  return ![")", "]", "}", "++", "--"].includes(previous.text);
}

function consumeRegex(
  text: string,
  index: number,
  tokens: Token[],
): number {
  pushToken(tokens, "stringDelimiter", "/");
  let cursor = index + 1;
  let inCharacterClass = false;
  while (cursor < text.length) {
    const char = text[cursor];
    assertNonNullable(char, "正規表現入力の位置を取得できません。");
    if (char === "\r" || char === "\n") {
      throw new UnsupportedDiffError("改行を含む正規表現を解釈できません。");
    }
    if (char === "\\") {
      const next = text[cursor + 1];
      if (next == null || next === "\r" || next === "\n") {
        throw new UnsupportedDiffError("閉じていない正規表現があります。");
      }
      pushToken(tokens, "stringEscape", text.slice(cursor, cursor + 2));
      cursor += 2;
      continue;
    }
    if (char === "[") {
      inCharacterClass = true;
      pushToken(tokens, "stringPunctuation", char);
      cursor += 1;
      continue;
    }
    if (char === "]") {
      inCharacterClass = false;
      pushToken(tokens, "stringPunctuation", char);
      cursor += 1;
      continue;
    }
    if (char === "/" && inCharacterClass === false) {
      pushToken(tokens, "stringDelimiter", char);
      cursor += 1;
      while (cursor < text.length) {
        const flag = text[cursor];
        assertNonNullable(flag, "正規表現のフラグ位置を取得できません。");
        if (/^[A-Za-z]$/u.test(flag) === false) {
          break;
        }
        pushToken(tokens, "stringIdentifier", flag);
        cursor += 1;
      }
      return cursor;
    }
    if (isStringWhitespace(char)) {
      const start = cursor;
      cursor += 1;
      while (cursor < text.length) {
        const whitespace = text[cursor];
        assertNonNullable(whitespace, "正規表現の空白位置を取得できません。");
        if (
          isStringWhitespace(whitespace) === false ||
          whitespace === "\r" ||
          whitespace === "\n"
        ) {
          break;
        }
        cursor += 1;
      }
      pushToken(tokens, "stringWhitespace", text.slice(start, cursor));
      continue;
    }
    if (isIdentifierStart(char)) {
      const start = cursor;
      cursor += 1;
      while (cursor < text.length) {
        const part = text[cursor];
        assertNonNullable(part, "正規表現の字句位置を取得できません。");
        if (isIdentifierPart(part) === false) {
          break;
        }
        cursor += 1;
      }
      pushToken(tokens, "stringIdentifier", text.slice(start, cursor));
      continue;
    }
    if (isDigit(char)) {
      const start = cursor;
      cursor += 1;
      while (cursor < text.length) {
        const part = text[cursor];
        assertNonNullable(part, "正規表現の数値位置を取得できません。");
        if (isDigit(part) === false) {
          break;
        }
        cursor += 1;
      }
      pushToken(tokens, "stringNumber", text.slice(start, cursor));
      continue;
    }
    pushToken(tokens, "stringPunctuation", char);
    cursor += 1;
  }
  throw new UnsupportedDiffError("閉じていない正規表現があります。");
}

function consumeString(
  text: string,
  index: number,
  mode: LexicalMode,
  tokens: Token[],
): number {
  const delimiter = text[index];
  assertNonNullable(delimiter, "文字列の開始位置を取得できません。");
  const triple =
    mode === "python" &&
    (delimiter === "'" || delimiter === '"') &&
    text.startsWith(delimiter + delimiter + delimiter, index);
  const opening = triple ? delimiter + delimiter + delimiter : delimiter;
  pushToken(tokens, "stringDelimiter", opening);
  let cursor = index + opening.length;
  while (cursor < text.length) {
    if (
      mode === "yaml" &&
      delimiter === "'" &&
      text.startsWith("''", cursor)
    ) {
      pushToken(tokens, "stringEscape", "''");
      cursor += 2;
      continue;
    }
    if (text.startsWith(opening, cursor)) {
      pushToken(tokens, "stringDelimiter", opening);
      return cursor + opening.length;
    }
    const char = text[cursor];
    assertNonNullable(char, "文字列入力の位置を取得できません。");
    if (mode !== "shell" || delimiter !== "'") {
      if (char === "\\") {
        const next = text[cursor + 1];
        if (next == null) {
          throw new UnsupportedDiffError("閉じていない文字列があります。");
        }
        pushToken(tokens, "stringEscape", text.slice(cursor, cursor + 2));
        cursor += 2;
        continue;
      }
    }
    if (isStringWhitespace(char)) {
      const start = cursor;
      cursor += 1;
      while (cursor < text.length) {
        const whitespace = text[cursor];
        assertNonNullable(whitespace, "文字列の空白位置を取得できません。");
        if (isStringWhitespace(whitespace) === false) {
          break;
        }
        cursor += 1;
      }
      pushToken(tokens, "stringWhitespace", text.slice(start, cursor));
      continue;
    }
    if (isIdentifierStart(char)) {
      const start = cursor;
      cursor += 1;
      while (cursor < text.length) {
        const part = text[cursor];
        assertNonNullable(part, "文字列の字句位置を取得できません。");
        if (isIdentifierPart(part) === false) {
          break;
        }
        cursor += 1;
      }
      pushToken(tokens, "stringIdentifier", text.slice(start, cursor));
      continue;
    }
    if (isDigit(char)) {
      const start = cursor;
      cursor += 1;
      while (cursor < text.length) {
        const part = text[cursor];
        assertNonNullable(part, "文字列の数値位置を取得できません。");
        if (isDigit(part) === false && part !== ".") {
          break;
        }
        cursor += 1;
      }
      pushToken(tokens, "stringNumber", text.slice(start, cursor));
      continue;
    }
    pushToken(tokens, "stringPunctuation", char);
    cursor += 1;
  }
  throw new UnsupportedDiffError("閉じていない文字列があります。");
}

function endsAtLineStart(text: string): boolean {
  return text.endsWith("\n") || text.endsWith("\r");
}

function pushToken(tokens: Token[], kind: TokenKind, text: string): void {
  tokens.push({
    kind,
    text,
    key: kind + "\u0000" + text,
  });
}

function isStringWhitespace(char: string): boolean {
  return /\s/u.test(char);
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function isIdentifierStart(char: string): boolean {
  return char === "_" || char === "$" || /^\p{L}$/u.test(char);
}

function isIdentifierPart(char: string): boolean {
  return isIdentifierStart(char) || /^\p{N}$/u.test(char);
}
