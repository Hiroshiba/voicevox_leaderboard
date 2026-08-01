import { describe, expect, it } from "vitest";
import {
  calculateConventionalBonus,
  calculateFileScore,
  calculateImportance,
  calculatePullMass,
  calculateStandaloneIssueScore,
  totalAllocations,
} from "../src/domain/scoring";
import type { ScoreAllocation } from "../src/domain/model";

describe("calculateFileScore", () => {
  it("通常ファイルは 200 行を上限にする", () => {
    expect(
      calculateFileScore({
        filename: "src/App.vue",
        additions: 180,
        deletions: 80,
      }),
    ).toMatchObject({
      effectiveLines: 200,
      generated: false,
    });
  });

  it("文章ファイルは 0.5 倍にする", () => {
    expect(
      calculateFileScore({
        filename: "docs/guide.md",
        additions: 40,
        deletions: 10,
      }).effectiveLines,
    ).toBe(25);
  });

  it("lockfile は 0.05 倍にする", () => {
    expect(
      calculateFileScore({
        filename: "pnpm-lock.yaml",
        additions: 300,
        deletions: 100,
      }),
    ).toMatchObject({
      effectiveLines: 10,
      generated: true,
    });
  });

  it("拡張子が lock のファイルも生成物として扱う", () => {
    expect(
      calculateFileScore({
        filename: "poetry.lock",
        additions: 100,
        deletions: 0,
      }).effectiveLines,
    ).toBe(5);
  });
});

describe("calculateImportance", () => {
  it("小規模な E2E 追加を提案書どおり約 3.7 と評価する", () => {
    const importance = calculateImportance({
      effectiveLines: 23,
      nonGeneratedFiles: 1,
      repositoryCount: 1,
      conventionalBonus: 0.5,
    });

    expect(importance).toBeCloseTo(3.66, 1);
  });

  it("巨大な成果でも 15 を超えない", () => {
    expect(
      calculateImportance({
        effectiveLines: 100000,
        nonGeneratedFiles: 2000,
        repositoryCount: 20,
        conventionalBonus: 1.5,
      }),
    ).toBe(15);
  });
});

describe("calculatePullMass", () => {
  it("変更規模を対数評価する", () => {
    expect(calculatePullMass(20, 1)).toBe(2.5);
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
