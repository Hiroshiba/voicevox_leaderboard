import { describe, expect, it } from "vitest";
import {
  detectEvidenceKinds,
  isSubstantiveIssueText,
  isSubstantiveReviewText,
  normalizeContributionText,
} from "../src/domain/evidence";

describe("detectEvidenceKinds", () => {
  it("コマンド、環境、測定値、添付を種類別に数える", () => {
    const text = [
      "Ubuntu 24.04 で再現しました。",
      "$ pnpm run test",
      "処理時間: 120 ms",
      "![結果](https://github.com/user-attachments/assets/1234)",
    ].join("\n");

    expect(detectEvidenceKinds(text)).toEqual(
      expect.arrayContaining([
        "command",
        "attachment",
        "environment",
        "measurement",
      ]),
    );
  });
});

describe("normalizeContributionText", () => {
  it("引用とテンプレート項目を本文量から除く", () => {
    const text = [
      "> 長い引用です",
      "- [x] 確認項目",
      "<!-- テンプレート -->",
      "新しい調査結果です",
    ].join("\n");

    expect(normalizeContributionText(text)).toBe("新しい調査結果です");
  });
});

describe("実質判定", () => {
  it("短くても証拠要素があれば Issue 貢献とする", () => {
    expect(isSubstantiveIssueText("$ pnpm test")).toBe(true);
  });

  it("定型的な承認をレビュー貢献にしない", () => {
    expect(isSubstantiveReviewText("LGTM")).toBe(false);
    expect(isSubstantiveReviewText("ありがとうございます！")).toBe(false);
  });

  it("具体的なレビューを貢献とする", () => {
    expect(
      isSubstantiveReviewText(
        "この分岐では値が更新されないため、先にバリデーションが必要です。",
      ),
    ).toBe(true);
  });
});
