import { describe, expect, it } from "vitest";
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
import { createSankeyDiagramLayout } from "../src/services/sankeyDiagram";

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
  "レビュー重みが上限に満たないため未配分",
);
const issueLoss = unallocated(
  "workstream:issue-loss",
  "issue",
  1,
  "issue",
  "voicevox/voicevox#10",
  "Issue 枠の未配分",
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
  mergedAt: "2026-07-10T00:00:00Z",
  author: alice,
  authorIsHuman: true,
  coauthors: [],
  files: [],
  effectiveLines: 20,
  nonGeneratedFiles: 1,
  mass: 3,
  conventionalBonus: 1,
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

const result: LeaderboardResult = {
  range: {
    start: "2026-07-01",
    end: "2026-07-31",
  },
  contributors: [contributor],
  workstreams: [workstream],
  standaloneIssues: [standalone],
};

describe("createSankeyDiagramLayout", () => {
  it("同じ PR、Issue、人物を一つのノードへまとめる", () => {
    const layout = createSankeyDiagramLayout(result, contributor);
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
    expect(layout.selectedPoints).toBe(6);
    expect(layout.otherContributorPoints).toBe(3);
  });

  it("未配分点をノードにもリンクにも含めない", () => {
    const layout = createSankeyDiagramLayout(result, contributor);
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
    const layout = createSankeyDiagramLayout(result, contributor);
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
    const layout = createSankeyDiagramLayout(result, contributor);
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
      createSankeyDiagramLayout(invalidResult, contributor),
    ).toThrow("総量と詳細経路の合計が一致しません");
  });
});

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
