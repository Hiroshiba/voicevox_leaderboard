import { describe, expect, it } from "vitest";
import { analyzeFileChange } from "../scripts/analyzeDiff.ts";
import type { EditGroup, FileScore } from "../src/domain/model.ts";

type ChangeInput = Parameters<typeof analyzeFileChange>[0];

describe("analyzeFileChange", () => {
  it("同じ字句編集を一つの group にまとめる", () => {
    const result = analyzeFileChange(
      createChange(
        "src/example.ts",
        ["const value = 1;", "const value = 1;"],
        ["const value = 2;", "const value = 2;"],
      ),
      false,
    );

    const groups = measuredGroups(result);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      beforeTokens: 1,
      afterTokens: 1,
      occurrences: 2,
      weight: 1,
    });
    expect(groups[0]?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("同じ編集の fingerprint はファイルをまたいでも一致する", () => {
    const before = ["const value = 1;"];
    const after = ["const value = 2;"];

    const left = measuredGroups(
      analyzeFileChange(createChange("src/left.ts", before, after), false),
    );
    const right = measuredGroups(
      analyzeFileChange(createChange("tests/right.ts", before, after), false),
    );

    expect(left[0]?.fingerprint).toBe(right[0]?.fingerprint);
  });

  it("通常の空白変更を除外する", () => {
    const result = analyzeFileChange(
      createChange("src/example.ts", ["const value = 1;"], ["const  value = 1;"]),
      false,
    );

    expect(measuredGroups(result)).toEqual([]);
  });

  it("文字列内部の空白変更を保持する", () => {
    const result = analyzeFileChange(
      createChange('src/example.ts', ['const value = "a  b";'], ['const value = "a b";']),
      false,
    );

    expect(measuredGroups(result)).toHaveLength(1);
    expect(measuredGroups(result)[0]).toMatchObject({
      beforeTokens: 1,
      afterTokens: 1,
    });
  });

  it("字句種別が違う編集を同じ fingerprint にしない", () => {
    const identifier = measuredGroups(
      analyzeFileChange(
        createChange("src/example.ts", ["const old = 1;"], ["const new = 1;"]),
        false,
      ),
    );
    const stringContent = measuredGroups(
      analyzeFileChange(
        createChange('src/example.ts', ['const value = "old";'], ['const value = "new";']),
        false,
      ),
    );

    expect(identifier[0]?.fingerprint).not.toBe(stringContent[0]?.fingerprint);
  });

  it("文書ファイルの group に 0.5 の重みを付ける", () => {
    const result = analyzeFileChange(
      createChange("docs/guide.md", ["value"], ["changed"]),
      false,
    );

    expect(measuredGroups(result)[0]?.weight).toBe(0.5);
  });

  it("文書 URL の組織名置換を異なるパスでも同じ group にまとめる", () => {
    const result = analyzeFileChange(
      createChange(
        "README.md",
        [
          "[core](https://github.com/Hiroshiba/voicevox_core/releases)",
          "[editor](https://github.com/Hiroshiba/voicevox/releases)",
        ],
        [
          "[core](https://github.com/VOICEVOX/voicevox_core/releases)",
          "[editor](https://github.com/VOICEVOX/voicevox/releases)",
        ],
      ),
      false,
    );

    expect(measuredGroups(result)).toMatchObject([
      {
        beforeTokens: 1,
        afterTokens: 1,
        occurrences: 2,
        weight: 0.5,
      },
    ]);
  });

  it("文書の引用符をコード文字列として解釈しない", () => {
    const result = analyzeFileChange(
      createChange("README.md", ['Use "old'], ['Use "new']),
      false,
    );

    expect(measuredGroups(result)).not.toEqual([]);
  });

  it("Python と YAML の構造的な行頭空白を保持する", () => {
    const python = analyzeFileChange(
      createChange("src/example.py", ["  value = 1"], ["    value = 1"]),
      false,
    );
    const yaml = analyzeFileChange(
      createChange("config/example.yml", ["  value: 1"], ["    value: 1"]),
      false,
    );

    expect(measuredGroups(python)[0]).toMatchObject({
      beforeTokens: 1,
      afterTokens: 1,
    });
    expect(measuredGroups(yaml)[0]).toMatchObject({
      beforeTokens: 1,
      afterTokens: 1,
    });
  });

  it("Python の文字列 prefix と YAML の単引用符 escape を保持する", () => {
    const python = analyzeFileChange(
      createChange('src/example.py', ['value = r"a  b"'], ['value = r"a b"']),
      false,
    );
    const yaml = analyzeFileChange(
      createChange("config/example.yml", ["value: 'a''b'"], ["value: 'a''c'"]),
      false,
    );

    expect(measuredGroups(python)).not.toEqual([]);
    expect(measuredGroups(yaml)).not.toEqual([]);
  });

  it("YAML の plain scalar 内の空白を保持する", () => {
    const result = analyzeFileChange(
      createChange("config/example.yml", ["value: old  value"], ["value: old value"]),
      false,
    );

    expect(measuredGroups(result)).not.toEqual([]);
  });

  it("Shell の意味を持つ空白を保持する", () => {
    const result = analyzeFileChange(
      createChange("scripts/example.sh", ["echo value"], ["echo  value"]),
      false,
    );

    expect(measuredGroups(result)[0]).toMatchObject({
      beforeTokens: 1,
      afterTokens: 1,
    });
  });

  it("Dockerfile と Dockerfile の派生名を shell 字句として扱う", () => {
    const dockerfile = analyzeFileChange(
      createChange(
        "example/Dockerfile",
        ["RUN mv old core/* /voicevox/"],
        ["RUN mv new core/* /voicevox/"],
      ),
      false,
    );
    const variant = analyzeFileChange(
      createChange(
        "example/Dockerfile.cuda",
        ["RUN mv old core/* /voicevox/"],
        ["RUN mv new core/* /voicevox/"],
      ),
      false,
    );

    expect(measuredGroups(dockerfile)).not.toEqual([]);
    expect(measuredGroups(variant)).not.toEqual([]);
  });

  it("JavaScript の単項演算子と加算演算子の変化を保持する", () => {
    const result = analyzeFileChange(
      createChange("src/example.js", ["value + +index"], ["value++index"]),
      false,
    );

    expect(measuredGroups(result)).not.toEqual([]);
  });

  it("JavaScript の ASI 改行を保持する", () => {
    const result = analyzeFileChange(
      createChange("src/example.js", ["return", "value"], ["return value"]),
      false,
    );

    expect(measuredGroups(result)).not.toEqual([]);
  });

  it("JavaScript の正規表現内部の空白を保持する", () => {
    const result = analyzeFileChange(
      createChange("src/example.js", ["const value = /a  b/;"], ["const value = /a b/;"]),
      false,
    );

    expect(measuredGroups(result)).not.toEqual([]);
  });

  it("CSS の子孫セレクターの空白を保持する", () => {
    const result = analyzeFileChange(
      createChange("src/example.css", ["a  b {}"], ["a b {}"]),
      false,
    );

    expect(measuredGroups(result)).not.toEqual([]);
  });

  it("コメント指令をコメント字句として保持する", () => {
    const result = analyzeFileChange(
      createChange(
        "src/example.py",
        ["value = 1  # pyright: ignore"],
        ["value = 2  # pyright: ignore"],
      ),
      false,
    );

    expect(measuredGroups(result)).toHaveLength(1);
    expect(measuredGroups(result)[0]?.beforeTokens).toBe(1);
  });

  it("Vue と Astro の wrapper を軽量字句として扱う", () => {
    const vue = analyzeFileChange(
      createChange(
        "src/Example.vue",
        ["<script setup>const value = 1;</script>"],
        ["<script setup>const value = 2;</script>"],
      ),
      false,
    );
    const astro = analyzeFileChange(
      createChange(
        "src/Example.astro",
        ["---", "const value = 1;", "---"],
        ["---", "const value = 2;", "---"],
      ),
      false,
    );

    expect(measuredGroups(vue)).not.toEqual([]);
    expect(measuredGroups(astro)).not.toEqual([]);
  });

  it("生成物を字句算定から分ける", () => {
    const result = analyzeFileChange(
      createChange("src/components/foo-snapshots/example.ts", ["one"], ["two"]),
      false,
    );

    expect(result.analysis).toEqual({ kind: "generated" });
  });

  it("既知の binary を字句算定から分ける", () => {
    const result = analyzeFileChange(
      createChange("assets/example.png", ["one"], ["two"]),
      false,
    );

    expect(result.analysis).toEqual({
      kind: "unmeasured",
      reason: "binary",
    });
  });

  it("VOICEVOX の vvm を binary として分ける", () => {
    const result = analyzeFileChange(
      createChange("resources/example.vvm", ["one"], ["two"]),
      false,
    );

    expect(result.analysis).toEqual({
      kind: "unmeasured",
      reason: "binary",
    });
  });

  it("patch がない変更を未測定として記録する", () => {
    const result = analyzeFileChange(
      {
        filename: "src/example.ts",
        additions: 1,
        deletions: 0,
        sha: "new-sha",
      },
      false,
    );

    expect(result.analysis).toEqual({
      kind: "unmeasured",
      reason: "patchMissing",
    });
    expect(result).not.toHaveProperty("patch");
    expect(result.sha).toBe("new-sha");
  });

  it("hunk の行数不一致を打切りとして記録する", () => {
    const result = analyzeFileChange(
      {
        filename: "src/example.ts",
        additions: 1,
        deletions: 1,
        patch: "@@ -1,1 +1,1 @@\n-old",
      },
      false,
    );

    expect(result.analysis).toEqual({
      kind: "unmeasured",
      reason: "patchTruncated",
    });
  });

  it("API の集計値と patch の集計値が違えば打切りとして記録する", () => {
    const result = analyzeFileChange(
      {
        filename: "src/example.ts",
        additions: 2,
        deletions: 1,
        patch: "@@ -1,1 +1,1 @@\n-old\n+new",
      },
      false,
    );

    expect(result.analysis).toEqual({
      kind: "unmeasured",
      reason: "patchTruncated",
    });
  });

  it("rename と未対応の引用文字列を未対応として記録する", () => {
    const renamed = analyzeFileChange(
      {
        filename: "src/new.ts",
        additions: 1,
        deletions: 1,
        previousFilename: "src/old.ts",
        patch: "@@ -1,1 +1,1 @@\n-old\n+new",
      },
      false,
    );
    const unclosedString = analyzeFileChange(
      {
        filename: "src/example.ts",
        additions: 1,
        deletions: 1,
        patch: "@@ -1,1 +1,1 @@\n-const value = \"old\n+const value = \"new",
      },
      false,
    );

    expect(renamed.analysis).toEqual({
      kind: "unmeasured",
      reason: "unsupported",
    });
    expect(unclosedString.analysis).toEqual({
      kind: "unmeasured",
      reason: "unsupported",
    });
  });
});

function createChange(
  filename: string,
  before: string[],
  after: string[],
): ChangeInput {
  return {
    filename,
    additions: after.length,
    deletions: before.length,
    patch:
      "@@ -1," +
      before.length +
      " +1," +
      after.length +
      " @@\n" +
      before.map((line) => "-" + line).join("\n") +
      "\n" +
      after.map((line) => "+" + line).join("\n"),
  };
}

function measuredGroups(result: FileScore): EditGroup[] {
  if (result.analysis.kind !== "measured") {
    throw new Error("字句算定結果が measured ではありません。");
  }
  return result.analysis.groups;
}
