/// <reference types="node" />

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { assertNonNullable } from "../src/domain/errors";
import type {
  Actor,
  ContributorScore,
  LeaderboardResult,
  PreparedPull,
  ScoreAllocation,
  ScoreEntry,
  StandaloneIssueScore,
  UnallocatedScore,
  WorkstreamScore,
} from "../src/domain/model";
import { parseLeaderboardDataset } from "../src/domain/dataset";
import { calculateLeaderboard } from "../src/services/calculateLeaderboard";
import type { RangeSelection } from "../src/services/calculationScope";
import {
  createSankeyDiagramLayout,
  type SankeyDiagramSelection,
} from "../src/services/sankeyDiagram";

const alice = actor("alice");
const bob = actor("bob");

const aliceImplementation = allocation(
  "pull:alice",
  alice,
  "implementation",
  3,
  "pull",
  "voicevox/voicevox#1",
  "PR 作者として配分",
);
const bobReview = allocation(
  "pull:bob-review",
  bob,
  "review",
  2,
  "pull",
  "voicevox/voicevox#1",
  "実質的なレビュースレッド",
);
const aliceLinkedIssue = allocation(
  "issue:alice",
  alice,
  "issue",
  1,
  "issue",
  "voicevox/voicevox#10",
  "Issue 作成",
);
const bobLinkedIssue = allocation(
  "issue:bob",
  bob,
  "issue",
  1,
  "issue",
  "voicevox/voicevox#10",
  "実質的コメント 1 件目",
);
const reviewLoss = unallocated(
  "workstream:review-loss",
  "review",
  2,
  "issue",
  "voicevox/voicevox#10",
  "レビュー重みが上限に満たないため残りは配点対象外",
);
const issueLoss = unallocated(
  "workstream:issue-loss",
  "issue",
  1,
  "issue",
  "voicevox/voicevox#10",
  "Issue 枠は配点対象外",
);
const aliceStandaloneIssue = allocation(
  "standalone:alice",
  alice,
  "issue",
  2,
  "issue",
  "voicevox/voicevox#20",
  "実質的コメント 1 件目",
);

const pull: PreparedPull = {
  key: "voicevox/voicevox#1",
  repository: "VOICEVOX/voicevox",
  number: 1,
  title: "音声合成処理を実装する",
  githubUrl: "https://github.com/VOICEVOX/voicevox/pull/1",
  createdAt: "2026-07-01T00:00:00Z",
  outcome: {
    kind: "merged",
    mergedAt: "2026-07-10T00:00:00Z",
    mergedBy: bob,
    mergedByIsHuman: true,
  },
  author: alice,
  authorIsHuman: true,
  coauthors: [],
  files: [],
  effectiveLines: 20,
  nonGeneratedFiles: 1,
  mass: 3,
  conventionalBonus: 1,
  fullAiImplementation: false,
  reviews: [],
  reviewThreads: [],
  issueKey: "voicevox/voicevox#10",
};

const workstream: WorkstreamScore = {
  key: "voicevox/voicevox#10",
  title: "音声合成を改善する",
  source: {
    type: "issue",
    key: "voicevox/voicevox#10",
  },
  issue: {
    key: "voicevox/voicevox#10",
    repository: "VOICEVOX/voicevox",
    number: 10,
    title: "音声合成を改善する",
  },
  pulls: [pull],
  effectiveLines: 20,
  nonGeneratedFiles: 1,
  repositoryCount: 1,
  conventionalBonus: 1,
  importance: 10,
  implementationPoints: 3,
  reviewPoints: 2,
  issuePoints: 2,
  allocations: [
    aliceImplementation,
    bobReview,
    aliceLinkedIssue,
    bobLinkedIssue,
  ],
  unallocatedPoints: 3,
  unallocatedEntries: [reviewLoss, issueLoss],
};

const standalone: StandaloneIssueScore = {
  key: "voicevox/voicevox#20",
  repository: "VOICEVOX/voicevox",
  number: 20,
  title: "不具合を調査する",
  statusBonus: 2,
  evidenceCount: 1,
  substantiveCommentCount: 1,
  participantCount: 1,
  score: 2,
  allocations: [aliceStandaloneIssue],
};

const contributor: ContributorScore = {
  ...alice,
  rank: 1,
  score: 6,
  implementationPoints: 3,
  reviewPoints: 0,
  issuePoints: 3,
  entries: [
    toEntry(aliceImplementation),
    toEntry(aliceLinkedIssue),
    toEntry(aliceStandaloneIssue),
  ],
};

const contributorSelection = {
  type: "contributor",
  contributor,
} satisfies SankeyDiagramSelection;

const result: LeaderboardResult = {
  range: {
    start: "2026-07-01",
    end: "2026-07-31",
  },
  contributors: [contributor],
  workstreams: [workstream],
  standaloneIssues: [standalone],
};
const rangeSelection = {
  type: "absolute",
  range: result.range,
} satisfies RangeSelection;

const aliceReview = allocation(
  "pull:alice-review",
  alice,
  "review",
  2,
  "pull",
  "voicevox/voicevox#1",
  "実質的なレビュースレッド",
);

const parallelWorkstream: WorkstreamScore = {
  ...workstream,
  importance: 5,
  implementationPoints: 3,
  reviewPoints: 2,
  issuePoints: 0,
  allocations: [aliceImplementation, aliceReview],
  unallocatedPoints: 0,
  unallocatedEntries: [],
};

const parallelContributor: ContributorScore = {
  ...alice,
  rank: 1,
  score: 5,
  implementationPoints: 3,
  reviewPoints: 2,
  issuePoints: 0,
  entries: [toEntry(aliceImplementation), toEntry(aliceReview)],
};

const parallelResult: LeaderboardResult = {
  ...result,
  contributors: [parallelContributor],
  workstreams: [parallelWorkstream],
  standaloneIssues: [],
};

const parallelContributorSelection = {
  type: "contributor",
  contributor: parallelContributor,
} satisfies SankeyDiagramSelection;

describe("createSankeyDiagramLayout", () => {
  it("同じ PR、Issue、人物を一つのノードへまとめる", () => {
    const layout = createSankeyDiagramLayout(
      result,
      contributorSelection,
      rangeSelection,
    );
    const pullNodes = layout.nodes.filter((node) => node.role === "pull");
    const issueNodes = layout.nodes.filter((node) => node.role === "issue");
    const actorNodes = layout.nodes.filter((node) => node.role === "actor");
    const aliceNodes = actorNodes.filter((node) => node.id === "actor:alice");
    const bobNodes = actorNodes.filter((node) => node.id === "actor:bob");

    expect(new Set(layout.nodes.map((node) => node.id)).size).toBe(
      layout.nodes.length,
    );
    expect(pullNodes).toHaveLength(1);
    expect(issueNodes).toHaveLength(2);
    expect(actorNodes).toHaveLength(2);
    expect(aliceNodes).toHaveLength(1);
    expect(aliceNodes[0]?.points).toBe(6);
    expect(bobNodes).toHaveLength(1);
    expect(bobNodes[0]?.points).toBe(3);
    expect(layout.originCount).toBe(2);
    expect(layout.allocationCount).toBe(5);
    expect(layout.highlightedPoints).toBe(6);
    expect(layout.totalAllocatedPoints).toBe(9);
    expect(layout.contributorCount).toBe(2);
  });

  it("配点対象外の点をノードにもリンクにも含めない", () => {
    const layout = createSankeyDiagramLayout(
      result,
      contributorSelection,
      rangeSelection,
    );
    const ids = [
      ...layout.nodes.map((node) => node.id),
      ...layout.links.map((link) => link.id),
    ];

    expect(layout.links).toHaveLength(7);
    expect(ids.some((id) => id.includes("review-loss"))).toBe(false);
    expect(ids.some((id) => id.includes("issue-loss"))).toBe(false);
    expect("unallocatedPoints" in layout).toBe(false);
  });

  it("PR から人物へ直接つなぎ、Issue 経由の配点は中列へつなぐ", () => {
    const layout = createSankeyDiagramLayout(
      result,
      contributorSelection,
      rangeSelection,
    );
    const pullId = "pull:voicevox/voicevox#1";
    const issueId = "issue:voicevox/voicevox#10";
    const directLink = layout.links.find(
      (link) =>
        link.sourceId === pullId &&
        link.targetId === "actor:alice" &&
        link.kind === "implementation",
    );
    const issueInputLinks = layout.links.filter(
      (link) => link.sourceId === pullId && link.targetId === issueId,
    );
    const issueOutputLinks = layout.links.filter(
      (link) =>
        link.sourceId === issueId && link.targetId.startsWith("actor:"),
    );
    const pullNode = layout.nodes.find((node) => node.id === pullId);
    const issueNode = layout.nodes.find((node) => node.id === issueId);
    const actorNode = layout.nodes.find((node) => node.id === "actor:alice");

    expect(directLink?.points).toBe(3);
    expect(issueInputLinks).toHaveLength(2);
    expect(issueInputLinks.every((link) => link.kind === "issue")).toBe(true);
    expect(issueInputLinks.reduce((total, link) => total + link.points, 0)).toBe(
      2,
    );
    expect(issueOutputLinks).toHaveLength(2);
    expect(issueOutputLinks.reduce((total, link) => total + link.points, 0)).toBe(
      2,
    );
    expect(pullNode?.x).toBeLessThan(issueNode?.x ?? 0);
    expect(issueNode?.x).toBeLessThan(actorNode?.x ?? 0);
    expect(directLink?.sourceId).toBe(pullId);
    expect(directLink?.targetId).toBe("actor:alice");
  });

  it("配点種別をノードにせずリンクへ保持する", () => {
    const layout = createSankeyDiagramLayout(
      result,
      contributorSelection,
      rangeSelection,
    );
    const roles = new Set(layout.nodes.map((node) => node.role));
    const kinds = new Set(layout.links.map((link) => link.kind));

    expect(roles).toEqual(new Set(["pull", "issue", "actor"]));
    expect(kinds).toEqual(new Set(["implementation", "review", "issue"]));
    expect(
      layout.nodes.every((node) => node.href.startsWith("/")),
    ).toBe(true);
    expect(
      layout.links.every((link) => link.href.startsWith("/")),
    ).toBe(true);
  });

  it("同じ始点と終点の帯に隙間を設ける", () => {
    const layout = createSankeyDiagramLayout(
      parallelResult,
      parallelContributorSelection,
      rangeSelection,
    );
    const parallelLinks = layout.links.filter(
      (link) =>
        link.sourceId === "pull:voicevox/voicevox#1" &&
        link.targetId === "actor:alice",
    );

    expect(parallelLinks).toHaveLength(2);
    expect(new Set(parallelLinks.map((link) => link.kind))).toEqual(
      new Set(["implementation", "review"]),
    );
    const paths = parallelLinks.map((link) => ({
      link,
      path: parseCubicPath(link.path),
    }));
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const centers = paths.map(({ path }) => evaluateCubic(path, t));
      const firstCenter = centers[0];
      const secondCenter = centers[1];
      assertNonNullable(firstCenter, "平行経路の一つ目の中心位置がありません。");
      assertNonNullable(secondCenter, "平行経路の二つ目の中心位置がありません。");
      const centerDistance = Math.abs(firstCenter - secondCenter);
      const halfWidthTotal = paths.reduce(
        (distance, { link }) => distance + link.width / 2,
        0,
      );

      expect(centerDistance).toBeCloseTo(halfWidthTotal + 1, 10);
    }
  });

  it("片側のノードだけが同じ帯には隙間を設けない", () => {
    const layout = createSankeyDiagramLayout(
      result,
      contributorSelection,
      rangeSelection,
    );
    const pullLinks = layout.links
      .filter((link) => link.sourceId === "pull:voicevox/voicevox#1")
      .map((link) => ({ link, path: parseCubicPath(link.path) }))
      .sort((left, right) => left.path.startY - right.path.startY);
    const adjacent = pullLinks.find(
      (current, index) => {
        const next = pullLinks[index + 1];
        return next != null && current.link.targetId !== next.link.targetId;
      },
    );
    const adjacentIndex = adjacent == null ? -1 : pullLinks.indexOf(adjacent);
    const next = adjacentIndex < 0 ? undefined : pullLinks[adjacentIndex + 1];

    expect(adjacent).toBeDefined();
    expect(next).toBeDefined();
    if (adjacent == null || next == null) {
      throw new Error("異なる終点の隣接リンクがありません。");
    }
    expect(next.path.startY - adjacent.path.startY).toBeCloseTo(
      (adjacent.link.width + next.link.width) / 2,
      10,
    );
  });

  it("直近期間指定をノードとリンクへ引き継ぐ", () => {
    const layout = createSankeyDiagramLayout(
      result,
      contributorSelection,
      { type: "relative", count: 2, unit: "week" },
    );
    const hrefs = [
      ...layout.nodes.map((node) => node.href),
      ...layout.links.map((link) => link.href),
    ];

    expect(hrefs.every((href) => href.endsWith("?period=2w"))).toBe(true);
  });

  it("PR に関係する成果の配点経路を表示する", () => {
    const layout = createSankeyDiagramLayout(
      result,
      {
        type: "pull",
        key: pull.key,
      },
      rangeSelection,
    );
    const selectedNode = layout.nodes.find(
      (node) => node.id === "pull:voicevox/voicevox#1",
    );

    expect(selectedNode?.selected).toBe(true);
    expect(layout.nodes.some((node) => node.id.includes("#20"))).toBe(false);
    expect(layout.links).toHaveLength(6);
    expect(layout.links.every((link) => link.selected)).toBe(true);
    expect(layout.highlightedPoints).toBe(7);
    expect(layout.totalAllocatedPoints).toBe(7);
    expect(layout.contributorCount).toBe(2);
  });

  it("関連 Issue に関係する全成果の配点経路を表示する", () => {
    const layout = createSankeyDiagramLayout(
      result,
      {
        type: "issue",
        key: "voicevox/voicevox#10",
      },
      rangeSelection,
    );
    const selectedNode = layout.nodes.find(
      (node) => node.id === "issue:voicevox/voicevox#10",
    );

    expect(selectedNode?.selected).toBe(true);
    expect(layout.links).toHaveLength(6);
    expect(layout.links.every((link) => link.selected)).toBe(true);
    expect(layout.highlightedPoints).toBe(7);
    expect(layout.totalAllocatedPoints).toBe(7);
  });

  it("独立 Issue から人物への配点経路を表示する", () => {
    const layout = createSankeyDiagramLayout(
      result,
      {
        type: "issue",
        key: standalone.key,
      },
      rangeSelection,
    );
    const issueNode = layout.nodes.find(
      (node) => node.id === "issue:voicevox/voicevox#20",
    );

    expect(issueNode?.selected).toBe(true);
    expect(layout.nodes).toHaveLength(2);
    expect(layout.links).toHaveLength(1);
    expect(layout.highlightedPoints).toBe(2);
    expect(layout.totalAllocatedPoints).toBe(2);
    expect(layout.originCount).toBe(1);
  });

  it("成果総量と詳細経路の点数が一致しない場合は拒否する", () => {
    const invalidResult: LeaderboardResult = {
      ...result,
      workstreams: [
        {
          ...workstream,
          importance: 11,
        },
      ],
    };

    expect(() =>
      createSankeyDiagramLayout(
        invalidResult,
        contributorSelection,
        rangeSelection,
      ),
    ).toThrow("総量と詳細経路の合計が一致しません");
  });

  it("事前取得データの全対象について配点経路を生成できる", async () => {
    const raw: unknown = JSON.parse(
      await readFile(
        new URL("../public/data/leaderboard-data.json", import.meta.url),
        "utf8",
      ),
    );
    const dataset = parseLeaderboardDataset(raw);
    const actualResult = calculateLeaderboard(dataset, dataset.range);
    const actualRangeSelection = {
      type: "absolute",
      range: actualResult.range,
    } satisfies RangeSelection;
    const issueKeys = new Set<string>();
    let pullCount = 0;

    for (const actualContributor of actualResult.contributors) {
      createSankeyDiagramLayout(
        actualResult,
        {
          type: "contributor",
          contributor: actualContributor,
        },
        actualRangeSelection,
      );
    }
    for (const actualWorkstream of actualResult.workstreams) {
      if (actualWorkstream.allocations.length === 0) {
        continue;
      }
      for (const actualPull of actualWorkstream.pulls) {
        createSankeyDiagramLayout(
          actualResult,
          {
            type: "pull",
            key: actualPull.key,
          },
          actualRangeSelection,
        );
        pullCount += 1;
      }
      if (actualWorkstream.issue != null) {
        issueKeys.add(actualWorkstream.issue.key);
      }
    }
    for (const actualIssue of actualResult.standaloneIssues) {
      issueKeys.add(actualIssue.key);
    }
    for (const issueKey of issueKeys) {
      createSankeyDiagramLayout(
        actualResult,
        {
          type: "issue",
          key: issueKey,
        },
        actualRangeSelection,
      );
    }

    expect(actualResult.contributors.length).toBeGreaterThan(0);
    expect(pullCount).toBeGreaterThan(0);
    expect(issueKeys.size).toBeGreaterThan(0);
  });
});

interface CubicPath {
  startY: number;
  firstControlY: number;
  secondControlY: number;
  endY: number;
}

function parseCubicPath(path: string): CubicPath {
  const values = path
    .match(/-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi)
    ?.map(Number);
  if (values == null || values.length !== 8) {
    throw new Error("サンキー経路の曲線を解釈できません。");
  }
  const startY = values[1];
  const firstControlY = values[3];
  const secondControlY = values[5];
  const endY = values[7];
  if (
    startY == null ||
    firstControlY == null ||
    secondControlY == null ||
    endY == null
  ) {
    throw new Error("サンキー経路の曲線位置がありません。");
  }
  return { startY, firstControlY, secondControlY, endY };
}

function evaluateCubic(path: CubicPath, t: number): number {
  const inverse = 1 - t;
  return (
    inverse ** 3 * path.startY +
    3 * inverse ** 2 * t * path.firstControlY +
    3 * inverse * t ** 2 * path.secondControlY +
    t ** 3 * path.endY
  );
}

function actor(login: string): Actor {
  return {
    login,
    avatarUrl: "https://github.com/" + login + ".png",
  };
}

function allocation(
  id: string,
  target: Actor,
  kind: ScoreAllocation["kind"],
  points: number,
  sourceType: ScoreAllocation["source"]["type"],
  sourceKey: string,
  reason: string,
): ScoreAllocation {
  return {
    id,
    actor: target,
    kind,
    points,
    source: {
      type: sourceType,
      key: sourceKey,
    },
    sourceTitle: sourceKey,
    reason,
  };
}

function unallocated(
  id: string,
  kind: UnallocatedScore["kind"],
  points: number,
  sourceType: UnallocatedScore["source"]["type"],
  sourceKey: string,
  reason: string,
): UnallocatedScore {
  return {
    id,
    kind,
    points,
    source: {
      type: sourceType,
      key: sourceKey,
    },
    sourceTitle: sourceKey,
    reason,
  };
}

function toEntry(allocation: ScoreAllocation): ScoreEntry {
  return {
    id: allocation.id,
    kind: allocation.kind,
    points: allocation.points,
    source: allocation.source,
    sourceTitle: allocation.sourceTitle,
    reason: allocation.reason,
  };
}
