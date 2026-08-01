import { describe, expect, it } from "vitest";
import type {
  Actor,
  ContributorScore,
  LeaderboardResult,
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
const reviewLoss = unallocated(
  "workstream:review-loss",
  "review",
  3,
  "issue",
  "voicevox/voicevox#10",
  "レビュー重みが上限に満たないため未配分",
);
const issueLoss = unallocated(
  "workstream:issue-loss",
  "issue",
  2,
  "issue",
  "voicevox/voicevox#10",
  "期間内に配点対象の Issue 活動がないため未配分",
);
const aliceIssue = allocation(
  "standalone:alice",
  alice,
  "issue",
  2,
  "issue",
  "voicevox/voicevox#20",
  "実質的コメント 1 件目",
);

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
  pulls: [],
  effectiveLines: 20,
  nonGeneratedFiles: 1,
  repositoryCount: 1,
  conventionalBonus: 1,
  importance: 10,
  implementationPoints: 3,
  reviewPoints: 2,
  issuePoints: 0,
  allocations: [aliceImplementation, bobReview],
  unallocatedPoints: 5,
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
  allocations: [aliceIssue],
};

const contributor: ContributorScore = {
  ...alice,
  rank: 1,
  score: 5,
  implementationPoints: 3,
  reviewPoints: 0,
  issuePoints: 2,
  entries: [toEntry(aliceImplementation), toEntry(aliceIssue)],
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
  it("全配点経路を集約せず人物または図外まで接続する", () => {
    const layout = createSankeyDiagramLayout(result, contributor);
    const activityNodes = layout.nodes.filter(
      (node) => node.role === "activity",
    );
    const outsideNodes = layout.nodes.filter(
      (node) => node.role === "outside",
    );
    const selectedActors = layout.nodes.filter(
      (node) => node.role === "actor" && node.selected,
    );

    expect(layout.sourceCount).toBe(2);
    expect(layout.activityCount).toBe(5);
    expect(activityNodes).toHaveLength(5);
    expect(outsideNodes).toHaveLength(2);
    expect(layout.links).toHaveLength(10);
    expect(layout.selectedPoints).toBe(5);
    expect(layout.otherContributorPoints).toBe(2);
    expect(layout.unallocatedPoints).toBe(5);
    expect(selectedActors).toHaveLength(2);
    expect(
      selectedActors.reduce((total, node) => total + node.points, 0),
    ).toBe(5);
    expect(selectedActors.map((node) => node.label)).toEqual([
      "alice 3.00 点",
      "alice 2.00 点",
    ]);
  });

  it("貢献種別ノードを作らず個別活動を内部詳細ページへ結ぶ", () => {
    const layout = createSankeyDiagramLayout(result, contributor);
    const roles = new Set(layout.nodes.map((node) => node.role));
    const activityHrefs = layout.nodes
      .filter((node) => node.role === "activity")
      .map((node) => node.href);

    expect(roles).toEqual(
      new Set(["source", "activity", "actor", "outside"]),
    );
    expect(activityHrefs).toEqual(
      expect.arrayContaining([
        "#/pulls/voicevox/voicevox/1?start=2026-07-01&end=2026-07-31",
        "#/issues/voicevox/voicevox/10?start=2026-07-01&end=2026-07-31",
        "#/issues/voicevox/voicevox/20?start=2026-07-01&end=2026-07-31",
      ]),
    );
    expect(
      layout.nodes
        .filter((node) => node.href != null)
        .every((node) => node.href?.startsWith("#") === true),
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
