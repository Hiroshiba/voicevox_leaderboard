import { assertNonNullable, UnreachableError } from "../domain/errors.ts";
import type {
  Actor,
  ContributorScore,
  DateRange,
  EditGroup,
  EvidenceKind,
  IssueReference,
  LeaderboardDataset,
  LeaderboardResult,
  PreparedIssue,
  PreparedPull,
  PullEditContribution,
  PullOutcome,
  ScoreAllocation,
  ScoreEntry,
  SourceReference,
  StandaloneIssueScore,
  UnmeasuredReason,
  UnallocatedScore,
  WorkstreamScore,
} from "../domain/model.ts";
import { isFullAiRepository } from "../domain/fullAiRepositories.ts";
import {
  calculateAiActivityCredit,
  calculateEditGroupAmount,
  calculateImplementationReviewAssurance,
  calculateImplementationStateCredit,
  calculateImportance,
  calculateStandaloneIssueScore,
  calculatePullEditContributionRatios,
  calculateUncompressedEditGroupAmount,
  getPullScoringDate,
  resolvePullOutcomeAtRangeEnd,
  totalAllocations,
} from "../domain/scoring.ts";
import { parseDateRange } from "./calculationScope.ts";

interface ScoringPull {
  pull: PreparedPull;
  outcome: PullOutcome;
  scoringDate: string;
}

interface WorkstreamGroup {
  key: string;
  issue?: PreparedIssue;
  pulls: ScoringPull[];
}

interface WeightedOrigin {
  id: string;
  actor: Actor;
  weight: number;
  source: SourceReference;
  sourceTitle: string;
  reason: string;
}

interface IssueActivity {
  weightedOrigins: WeightedOrigin[];
  evidenceKinds: Set<EvidenceKind>;
  substantiveCommentCount: number;
  participantCount: number;
  hasActivityInRange: boolean;
}

interface ReviewEventBase {
  id: string;
  actor: Actor;
  createdAt: string;
  fullAiImplementation: boolean;
  source: SourceReference;
  sourceTitle: string;
}

type ReviewEvent =
  | (ReviewEventBase & {
      type: "submission";
      hasSubstantiveSummary: boolean;
    })
  | (ReviewEventBase & { type: "thread" });

interface AllocationResult {
  allocations: ScoreAllocation[];
  unallocatedEntries: UnallocatedScore[];
}

interface ReviewOrigin extends WeightedOrigin {
  fullAiImplementation: boolean;
}

interface EditGroupAggregate {
  fingerprint: string;
  beforeTokens: number;
  afterTokens: number;
  weight: EditGroup["weight"];
  occurrencesByPull: Map<string, number>;
}

interface WorkstreamEditSummary {
  uncompressedEditAmount: number;
  editAmount: number;
  generatedContribution: number;
  generatedFileCount: number;
  unmeasuredFileCount: number;
  unmeasuredReasons: Record<UnmeasuredReason, number>;
  pullEditContributions: PullEditContribution[];
}

/** 事前取得データを指定期間のリーダーボードへ変換する。 */
export function calculateLeaderboard(
  dataset: LeaderboardDataset,
  requestedRange: DateRange,
): LeaderboardResult {
  const range = parseDateRange(requestedRange, dataset.range);
  const issueByKey = new Map(
    dataset.issues.map((issue) => [issue.key, issue]),
  );
  const fullAiRepositories = new Set(
    dataset.repositories
      .filter((repository) => repository.fullAiImplementation)
      .map((repository) => repository.nameWithOwner.toLowerCase()),
  );
  const pulls = selectPullsForScoring(dataset.pulls, range);
  const groups = groupWorkstreams(pulls, issueByKey);
  const workstreams = groups
    .map((group) =>
      calculateWorkstream(group, range, fullAiRepositories),
    )
    .sort(
      (left, right) =>
        right.importance - left.importance ||
        left.key.localeCompare(right.key),
    );

  const linkedIssueKeys = new Set(
    pulls.flatMap(({ pull, outcome }) =>
      outcome.kind === "merged" && pull.issueKey != null
        ? [pull.issueKey]
        : [],
    ),
  );
  const standaloneIssues = dataset.issues
    .map((issue) =>
      calculateStandaloneIssue(
        issue,
        range,
        linkedIssueKeys,
        fullAiRepositories,
      ),
    )
    .filter((issue): issue is StandaloneIssueScore => issue != null)
    .sort(
      (left, right) =>
        right.score - left.score || left.key.localeCompare(right.key),
    );

  const standaloneAllocations = standaloneIssues.flatMap(
    (issue) => issue.allocations,
  );
  return {
    range,
    contributors: buildContributors(workstreams, standaloneAllocations),
    workstreams,
    standaloneIssues,
  };
}

function selectPullsForScoring(
  pulls: PreparedPull[],
  range: DateRange,
): ScoringPull[] {
  const selected: ScoringPull[] = [];
  for (const pull of pulls) {
    const outcome = resolvePullOutcomeAtRangeEnd(
      pull.outcome,
      range.end,
    );
    const scoringDate = getPullScoringDate(pull.createdAt, outcome);
    const scoringDateInRange = isDateInRange(scoringDate, range);
    if (outcome.kind === "merged") {
      if (scoringDateInRange) {
        selected.push({ pull, outcome, scoringDate });
      }
      continue;
    }
    if (scoringDateInRange || hasReviewActivityInRange(pull, range)) {
      selected.push({ pull, outcome, scoringDate });
    }
  }
  return selected;
}

function hasReviewActivityInRange(
  pull: PreparedPull,
  range: DateRange,
): boolean {
  return (
    pull.reviews.some((review) => isDateInRange(review.submittedAt, range)) ||
    pull.reviewThreads.some((thread) => isDateInRange(thread.createdAt, range))
  );
}

function groupWorkstreams(
  pulls: ScoringPull[],
  issueByKey: Map<string, PreparedIssue>,
): WorkstreamGroup[] {
  const groups = new Map<string, WorkstreamGroup>();
  for (const scoringPull of pulls) {
    const pull = scoringPull.pull;
    const key =
      scoringPull.outcome.kind === "merged"
        ? (pull.issueKey ?? "pr:" + pull.key)
        : "pr:" + pull.key;
    const current = groups.get(key);
    if (current != null) {
      current.pulls.push(scoringPull);
      continue;
    }

    if (pull.issueKey == null) {
      groups.set(key, { key, pulls: [scoringPull] });
      continue;
    }
    const issue = issueByKey.get(pull.issueKey);
    assertNonNullable(
      issue,
      pull.key + " の関連 Issue が事前取得データにありません。",
    );
    groups.set(key, { key, issue, pulls: [scoringPull] });
  }
  return [...groups.values()];
}

function calculateWorkstream(
  group: WorkstreamGroup,
  range: DateRange,
  fullAiRepositories: Set<string>,
): WorkstreamScore {
  const firstScoringPull = group.pulls[0];
  assertNonNullable(firstScoringPull, "ワークストリームに PR がありません。");
  const editSummary = calculateWorkstreamEditSummary(group);
  const repositoryCount = new Set(
    group.pulls.map(({ pull }) => pull.repository.toLowerCase()),
  ).size;
  const conventionalBonus = Math.max(
    ...group.pulls.map(({ pull }) => pull.conventionalBonus),
  );
  const importance = calculateImportance({
    editAmount: editSummary.editAmount,
    generatedContribution: editSummary.generatedContribution,
    repositoryCount,
    conventionalBonus,
  });
  const pullRatios = calculatePullEditContributionRatios(
    editSummary.pullEditContributions,
  );
  const merged = isMergedWorkstream(group);
  const scoringIssue = merged ? group.issue : undefined;
  const title = scoringIssue?.title ?? firstScoringPull.pull.title;
  const source = createSourceReference(scoringIssue, firstScoringPull.pull);
  const sourceTitle = createSourceTitle(scoringIssue, firstScoringPull.pull);
  const pullCreation = allocatePullCreation(
    group,
    importance,
    range,
    pullRatios,
  );
  const implementation = allocateImplementation(
    group,
    importance,
    range,
    pullRatios,
  );
  const review = allocateReviews(
    group,
    importance,
    range,
    source,
    sourceTitle,
  );
  const issue = allocateLinkedIssue(
    group,
    importance,
    range,
    source,
    sourceTitle,
    merged,
    fullAiRepositories,
  );
  const allocations = [
    ...pullCreation.allocations,
    ...implementation.allocations,
    ...review.allocations,
    ...issue.allocations,
  ];
  const unallocatedEntries = [
    ...pullCreation.unallocatedEntries,
    ...implementation.unallocatedEntries,
    ...review.unallocatedEntries,
    ...issue.unallocatedEntries,
  ];
  assertScoreConservation(
    importance,
    allocations,
    unallocatedEntries,
    group.key,
  );

  return {
    key: group.key,
    title,
    source,
    ...(group.issue == null ? {} : { issue: toIssueReference(group.issue) }),
    pulls: group.pulls.map(({ pull }) => pull),
    ...editSummary,
    repositoryCount,
    conventionalBonus,
    importance,
    implementationPoints: sum(
      [...pullCreation.allocations, ...implementation.allocations].map(
        (allocation) => allocation.points,
      ),
    ),
    reviewPoints: sum(
      review.allocations.map((allocation) => allocation.points),
    ),
    issuePoints: sum(
      issue.allocations.map((allocation) => allocation.points),
    ),
    allocations,
    unallocatedPoints: sum(
      unallocatedEntries.map((entry) => entry.points),
    ),
    unallocatedEntries,
  };
}

function calculateWorkstreamEditSummary(
  group: WorkstreamGroup,
): WorkstreamEditSummary {
  const aggregates = new Map<string, EditGroupAggregate>();
  const contributionByPull = new Map<string, number>();
  const generatedPullKeys = new Set<string>();
  const unmeasuredReasons = createUnmeasuredReasonCounts();
  let uncompressedEditAmount = 0;
  let editAmount = 0;
  let generatedFileCount = 0;
  let unmeasuredFileCount = 0;

  for (const { pull } of group.pulls) {
    if (contributionByPull.has(pull.key)) {
      throw new Error(group.key + " に同じ PR が複数含まれています。");
    }
    contributionByPull.set(pull.key, 0);
    for (const file of pull.files) {
      switch (file.analysis.kind) {
        case "measured":
          for (const editGroup of file.analysis.groups) {
            uncompressedEditAmount +=
              calculateUncompressedEditGroupAmount(editGroup);
            const current = aggregates.get(editGroup.fingerprint);
            if (current == null) {
              aggregates.set(editGroup.fingerprint, {
                fingerprint: editGroup.fingerprint,
                beforeTokens: editGroup.beforeTokens,
                afterTokens: editGroup.afterTokens,
                weight: editGroup.weight,
                occurrencesByPull: new Map([[pull.key, editGroup.occurrences]]),
              });
              continue;
            }
            if (
              current.beforeTokens !== editGroup.beforeTokens ||
              current.afterTokens !== editGroup.afterTokens ||
              current.weight !== editGroup.weight
            ) {
              throw new Error(
                "編集グループ " +
                  editGroup.fingerprint +
                  " の属性が一致しません。",
              );
            }
            const occurrences =
              current.occurrencesByPull.get(pull.key) ?? 0;
            current.occurrencesByPull.set(
              pull.key,
              occurrences + editGroup.occurrences,
            );
          }
          break;
        case "generated":
          generatedFileCount += 1;
          generatedPullKeys.add(pull.key);
          break;
        case "unmeasured":
          unmeasuredFileCount += 1;
          unmeasuredReasons[file.analysis.reason] += 1;
          break;
        default:
          throw new UnreachableError(file.analysis);
      }
    }
  }

  for (const aggregate of aggregates.values()) {
    const occurrences = sum([...aggregate.occurrencesByPull.values()]);
    const amount = calculateEditGroupAmount({
      fingerprint: aggregate.fingerprint,
      beforeTokens: aggregate.beforeTokens,
      afterTokens: aggregate.afterTokens,
      occurrences,
      weight: aggregate.weight,
    });
    editAmount += amount;
    for (const [pullKey, pullOccurrences] of aggregate.occurrencesByPull) {
      const current = contributionByPull.get(pullKey);
      assertNonNullable(
        current,
        group.key + " の編集グループに対応する PR がありません。",
      );
      contributionByPull.set(
        pullKey,
        current + amount * (pullOccurrences / occurrences),
      );
    }
  }

  const generatedContribution = generatedPullKeys.size > 0 ? 1 : 0;
  if (generatedPullKeys.size > 0) {
    const generatedAmount = generatedContribution / generatedPullKeys.size;
    for (const pullKey of generatedPullKeys) {
      const current = contributionByPull.get(pullKey);
      assertNonNullable(
        current,
        group.key + " の生成物に対応する PR がありません。",
      );
      contributionByPull.set(pullKey, current + generatedAmount);
    }
  }

  return {
    uncompressedEditAmount,
    editAmount,
    generatedContribution,
    generatedFileCount,
    unmeasuredFileCount,
    unmeasuredReasons,
    pullEditContributions: group.pulls.map(({ pull }) => {
      const amount = contributionByPull.get(pull.key);
      assertNonNullable(
        amount,
        group.key + " の PR 編集寄与量がありません。",
      );
      return { pullKey: pull.key, amount };
    }),
  };
}

function createUnmeasuredReasonCounts(): Record<UnmeasuredReason, number> {
  return {
    patchMissing: 0,
    patchTruncated: 0,
    binary: 0,
    unsupported: 0,
  };
}

function allocatePullCreation(
  group: WorkstreamGroup,
  importance: number,
  range: DateRange,
  pullRatios: Map<string, number>,
): AllocationResult {
  const allocations: ScoreAllocation[] = [];
  const unallocatedEntries: UnallocatedScore[] = [];
  for (const { pull } of group.pulls) {
    const pullRatio = pullRatios.get(pull.key);
    assertNonNullable(
      pullRatio,
      group.key + " の PR 編集寄与量比率がありません。",
    );
    const pullPool = 0.1 * importance * pullRatio;
    if (pullPool === 0) {
      continue;
    }
    const activityCredit = calculateAiActivityCredit(
      pull.fullAiImplementation,
    );
    const creditedPullPool = pullPool * activityCredit.creditRatio;
    const source = createPullSource(pull);
    const sourceTitle = createPullTitle(pull);
    const aiUnallocatedPoints = pullPool - creditedPullPool;
    if (aiUnallocatedPoints > 0) {
      unallocatedEntries.push(
        createUnallocatedScore(
          pull.key + ":implementation:creation:ai:unallocated",
          "implementation",
          aiUnallocatedPoints,
          source,
          sourceTitle,
          activityCredit.label +
            "のため PR 作成枠の" +
            formatPercent(1 - activityCredit.creditRatio) +
            "%が配点対象外",
        ),
      );
    }
    const inRange = isDateInRange(pull.createdAt, range);
    const reasons: string[] = [];
    if (inRange === false) {
      reasons.push("PR 作成日 " + pull.createdAt + " が期間外");
    }
    if (pull.authorIsHuman === false) {
      reasons.push("作者 " + pull.author.login + " が Bot ");
    }
    if (reasons.length > 0) {
      unallocatedEntries.push(
        createUnallocatedScore(
          pull.key + ":implementation:creation:unallocated",
          "implementation",
          creditedPullPool,
          source,
          sourceTitle,
          reasons.join("、") + "のため PR 作成ポイントは配点対象外",
        ),
      );
      continue;
    }
    allocations.push(
      createAllocation(
        pull.key + ":implementation:creation",
        pull.author,
        "implementation",
        creditedPullPool,
        source,
        sourceTitle,
        "PR 作成日 " +
          pull.createdAt +
          " が期間内のため作成ポイントを配分" +
          (activityCredit.type === "ai"
            ? "、" +
              activityCredit.label +
              "として作成枠の" +
              formatPercent(activityCredit.creditRatio) +
              "%を配分"
            : ""),
      ),
    );
  }
  return { allocations, unallocatedEntries };
}

function isMergedWorkstream(group: WorkstreamGroup): boolean {
  const first = group.pulls[0];
  assertNonNullable(first, "ワークストリームに PR がありません。");
  const merged = first.outcome.kind === "merged";
  if (
    group.pulls.some(
      ({ outcome }) => (outcome.kind === "merged") !== merged,
    )
  ) {
    throw new Error("ワークストリームに異なる状態の PR が混在しています。");
  }
  if (merged === false && group.pulls.length !== 1) {
    throw new Error("未マージ PR が同じワークストリームに混在しています。");
  }
  return merged;
}

function allocateImplementation(
  group: WorkstreamGroup,
  importance: number,
  range: DateRange,
  pullRatios: Map<string, number>,
): AllocationResult {
  const allocations: ScoreAllocation[] = [];
  const unallocatedEntries: UnallocatedScore[] = [];
  for (const scoringPull of group.pulls) {
    const { pull, outcome, scoringDate } = scoringPull;
    const pullRatio = pullRatios.get(pull.key);
    assertNonNullable(
      pullRatio,
      group.key + " の PR 編集寄与量比率がありません。",
    );
    const pullPool = 0.55 * importance * pullRatio;
    if (pullPool === 0) {
      continue;
    }
    const source = createPullSource(pull);
    const sourceTitle = createPullTitle(pull);
    if (isDateInRange(scoringDate, range) === false) {
      unallocatedEntries.push(
        createUnallocatedScore(
          pull.key + ":implementation:scoring-date:unallocated",
          "implementation",
          pullPool,
          source,
          sourceTitle,
          "配点対象日 " + scoringDate + " が期間外のため実装枠は配点対象外",
        ),
      );
      continue;
    }

    const activityCredit = calculateAiActivityCredit(
      pull.fullAiImplementation,
    );
    const reviewAssurance = calculateImplementationReviewAssurance(
      {
        ...pull,
        outcome,
      },
      range.end,
    );
    const stateCredit = calculateImplementationStateCredit(outcome);
    const creditedPullPool = pullPool * activityCredit.creditRatio;
    const reviewedPullPool =
      creditedPullPool * reviewAssurance.creditRatio;
    const distributablePullPool = reviewedPullPool * stateCredit.creditRatio;
    const assuranceLabel =
      activityCredit.type === "ai"
        ? activityCredit.label + "かつ" + reviewAssurance.label
        : reviewAssurance.label;
    const creditLabel =
      stateCredit.type === "merged"
        ? assuranceLabel
        : assuranceLabel + "かつ" + stateCredit.label;
    const reason =
      pull.repository +
      "#" +
      pull.number +
      " の編集寄与量の比率 " +
      (pullRatio * 100).toFixed(2) +
      "%" +
      " による配分、" +
      creditLabel +
      "として実装枠の" +
      formatPercent(
        activityCredit.creditRatio *
          reviewAssurance.creditRatio *
          stateCredit.creditRatio,
      ) +
      "%を配分";
    const aiUnallocatedPoints = pullPool - creditedPullPool;
    if (aiUnallocatedPoints > 0) {
      unallocatedEntries.push(
        createUnallocatedScore(
          pull.key + ":implementation:ai:unallocated",
          "implementation",
          aiUnallocatedPoints,
          source,
          sourceTitle,
          activityCredit.label +
            "のため実装枠の" +
            formatPercent(1 - activityCredit.creditRatio) +
            "%が配点対象外",
        ),
      );
    }
    const qualityUnallocatedPoints =
      creditedPullPool - reviewedPullPool;
    if (qualityUnallocatedPoints > 0) {
      unallocatedEntries.push(
        createUnallocatedScore(
          pull.key + ":implementation:review-assurance:unallocated",
          "implementation",
          qualityUnallocatedPoints,
          source,
          sourceTitle,
          reviewAssurance.label +
            "のため実装枠の" +
            formatPercent(
              activityCredit.creditRatio * (1 - reviewAssurance.creditRatio),
            ) +
            "%が配点対象外",
        ),
      );
    }
    const stateUnallocatedPoints = reviewedPullPool - distributablePullPool;
    if (stateUnallocatedPoints > 0) {
      unallocatedEntries.push(
        createUnallocatedScore(
          pull.key + ":implementation:state:unallocated",
          "implementation",
          stateUnallocatedPoints,
          source,
          sourceTitle,
          stateCredit.label +
            "のため実装枠の" +
            formatPercent(
              activityCredit.creditRatio *
                reviewAssurance.creditRatio *
                (1 - stateCredit.creditRatio),
            ) +
            "%が配点対象外",
        ),
      );
    }
    if (distributablePullPool === 0) {
      continue;
    }
    const authorRatio = pull.coauthors.length > 0 ? 0.7 : 1;
    if (pull.authorIsHuman) {
      allocations.push(
        createAllocation(
          pull.key + ":implementation:author",
          pull.author,
          "implementation",
          distributablePullPool * authorRatio,
          source,
          sourceTitle,
          reason,
        ),
      );
    } else {
      unallocatedEntries.push(
        createUnallocatedScore(
          pull.key + ":implementation:author:unallocated",
          "implementation",
          distributablePullPool * authorRatio,
          source,
          sourceTitle,
          pull.author.login + " が Bot のため作者分は配点対象外",
        ),
      );
    }

    if (pull.coauthors.length > 0) {
      const coauthorPool = distributablePullPool * 0.3;
      for (const coauthor of pull.coauthors) {
        allocations.push(
          createAllocation(
            pull.key +
              ":implementation:coauthor:" +
              coauthor.login.toLowerCase(),
            coauthor,
            "implementation",
            coauthorPool / pull.coauthors.length,
            source,
            sourceTitle,
            reason + "、共同作者枠",
          ),
        );
      }
    }
  }
  return { allocations, unallocatedEntries };
}

function allocateReviews(
  group: WorkstreamGroup,
  importance: number,
  range: DateRange,
  source: SourceReference,
  sourceTitle: string,
): AllocationResult {
  const events = new Map<string, ReviewEvent[]>();
  for (const { pull } of group.pulls) {
    const pullSource = createPullSource(pull);
    const pullTitle = createPullTitle(pull);
    for (const [reviewIndex, review] of pull.reviews.entries()) {
      if (isDateInRange(review.submittedAt, range) === false) {
        continue;
      }
      addReviewEvent(events, {
        id: pull.key + ":review:" + reviewIndex,
        type: "submission",
        actor: review.actor,
        createdAt: review.submittedAt,
        fullAiImplementation: pull.fullAiImplementation,
        source: pullSource,
        sourceTitle: pullTitle,
        hasSubstantiveSummary: review.hasSubstantiveSummary,
      });
    }
    for (const [threadIndex, thread] of pull.reviewThreads.entries()) {
      if (isDateInRange(thread.createdAt, range) === false) {
        continue;
      }
      addReviewEvent(events, {
        id: pull.key + ":review-thread:" + threadIndex,
        type: "thread",
        actor: thread.actor,
        createdAt: thread.createdAt,
        fullAiImplementation: pull.fullAiImplementation,
        source: pullSource,
        sourceTitle: pullTitle,
      });
    }
  }

  const origins = createReviewOrigins(events);
  const totalWeight = sum(origins.map((origin) => origin.weight));
  const maximumPoints = 0.2 * importance;
  if (totalWeight === 0) {
    return {
      allocations: [],
      unallocatedEntries: [
        createUnallocatedScore(
          group.key + ":review:unallocated",
          "review",
          maximumPoints,
          source,
          sourceTitle,
          "配点対象の人間レビューがないためレビュー枠は配点対象外",
        ),
      ],
    };
  }
  const allocatedPoints = maximumPoints * Math.min(1, totalWeight / 5);
  const allocations: ScoreAllocation[] = [];
  const aiUnallocatedByPull = new Map<
    string,
    { points: number; source: SourceReference; sourceTitle: string }
  >();
  for (const origin of origins) {
    const originPoints = allocatedPoints * (origin.weight / totalWeight);
    const activityCredit = calculateAiActivityCredit(
      origin.fullAiImplementation,
    );
    const creditedPoints = originPoints * activityCredit.creditRatio;
    if (creditedPoints > 0) {
      allocations.push(
        createAllocation(
          origin.id,
          origin.actor,
          "review",
          creditedPoints,
          origin.source,
          origin.sourceTitle,
          origin.reason +
            (activityCredit.type === "ai"
              ? "、" +
                activityCredit.label +
                "としてレビュー枠の" +
                formatPercent(activityCredit.creditRatio) +
                "%を配分"
              : ""),
        ),
      );
    }
    const aiUnallocatedPoints = originPoints - creditedPoints;
    if (aiUnallocatedPoints > 0) {
      const current = aiUnallocatedByPull.get(origin.source.key);
      if (current == null) {
        aiUnallocatedByPull.set(origin.source.key, {
          points: aiUnallocatedPoints,
          source: origin.source,
          sourceTitle: origin.sourceTitle,
        });
      } else {
        current.points += aiUnallocatedPoints;
      }
    }
  }
  const unallocatedPoints = maximumPoints - allocatedPoints;
  const unallocatedEntries = [...aiUnallocatedByPull.entries()].map(
    ([pullKey, entry]) =>
      createUnallocatedScore(
        pullKey + ":review:ai:unallocated",
        "review",
        entry.points,
        entry.source,
        entry.sourceTitle,
        "AI 由来の活動のためレビュー枠の70%が配点対象外",
      ),
  );
  if (unallocatedPoints > 0) {
    unallocatedEntries.push(
      createUnallocatedScore(
        group.key + ":review:unallocated",
        "review",
        unallocatedPoints,
        source,
        sourceTitle,
        "レビュー重み " +
          totalWeight.toFixed(2) +
          " が上限 5 に満たないため残りは配点対象外",
      ),
    );
  }
  return {
    allocations,
    unallocatedEntries,
  };
}

function allocateLinkedIssue(
  group: WorkstreamGroup,
  importance: number,
  range: DateRange,
  source: SourceReference,
  sourceTitle: string,
  merged: boolean,
  fullAiRepositories: Set<string>,
): AllocationResult {
  const maximumPoints = 0.15 * importance;
  if (merged === false) {
    return {
      allocations: [],
      unallocatedEntries: [
        createUnallocatedScore(
          group.key + ":issue:unallocated",
          "issue",
          maximumPoints,
          source,
          sourceTitle,
          "未マージ PR のため関連 Issue 枠は配点対象外",
        ),
      ],
    };
  }
  if (group.issue == null) {
    return {
      allocations: [],
      unallocatedEntries: [
        createUnallocatedScore(
          group.key + ":issue:unallocated",
          "issue",
          maximumPoints,
          source,
          sourceTitle,
          "関連 Issue がないため Issue 枠は配点対象外",
        ),
      ],
    };
  }
  const activity = analyzeIssueActivity(group.issue, range);
  const totalWeight = sum(
    activity.weightedOrigins.map((origin) => origin.weight),
  );
  if (totalWeight === 0) {
    return {
      allocations: [],
      unallocatedEntries: [
        createUnallocatedScore(
          group.key + ":issue:unallocated",
          "issue",
          maximumPoints,
          source,
          sourceTitle,
          "期間内に配点対象の Issue 活動がないため Issue 枠は配点対象外",
        ),
      ],
    };
  }
  const activityCredit = calculateAiActivityCredit(
    isFullAiRepository(fullAiRepositories, group.issue.repository),
  );
  const creditedMaximumPoints = maximumPoints * activityCredit.creditRatio;
  const unallocatedEntries: UnallocatedScore[] = [];
  const aiUnallocatedPoints = maximumPoints - creditedMaximumPoints;
  if (aiUnallocatedPoints > 0) {
    unallocatedEntries.push(
      createUnallocatedScore(
        group.key + ":issue:ai:unallocated",
        "issue",
        aiUnallocatedPoints,
        source,
        sourceTitle,
        activityCredit.label +
          "のため Issue 枠の" +
          formatPercent(1 - activityCredit.creditRatio) +
          "%が配点対象外",
      ),
    );
  }
  return {
    allocations: allocateIssueActivity(activity, creditedMaximumPoints),
    unallocatedEntries,
  };
}

function calculateStandaloneIssue(
  issue: PreparedIssue,
  range: DateRange,
  linkedIssueKeys: Set<string>,
  fullAiRepositories: Set<string>,
): StandaloneIssueScore | undefined {
  if (issue.activityCandidate === false || linkedIssueKeys.has(issue.key)) {
    return undefined;
  }
  if (
    issue.labels.some((label) => {
      const normalized = label.toLowerCase();
      return normalized === "invalid" || normalized === "spam";
    })
  ) {
    return undefined;
  }

  const activity = analyzeIssueActivity(issue, range);
  if (activity.hasActivityInRange === false) {
    return undefined;
  }
  const statusBonus = calculateIssueStatusBonus(issue, activity, range);
  if (isIssueOpenAtRangeEnd(issue, range) && statusBonus === 0) {
    return undefined;
  }
  const score = calculateStandaloneIssueScore(
    statusBonus,
    activity.evidenceKinds.size,
    activity.substantiveCommentCount,
    activity.participantCount,
  ) *
    calculateAiActivityCredit(
      isFullAiRepository(fullAiRepositories, issue.repository),
    ).creditRatio;
  const totalWeight = sum(
    activity.weightedOrigins.map((origin) => origin.weight),
  );
  if (score === 0 || totalWeight === 0) {
    return undefined;
  }
  return {
    key: issue.key,
    repository: issue.repository,
    number: issue.number,
    title: issue.title,
    statusBonus,
    evidenceCount: activity.evidenceKinds.size,
    substantiveCommentCount: activity.substantiveCommentCount,
    participantCount: activity.participantCount,
    score,
    allocations: allocateIssueActivity(activity, score),
  };
}

function analyzeIssueActivity(
  issue: PreparedIssue,
  range: DateRange,
): IssueActivity {
  const weightedOrigins: WeightedOrigin[] = [];
  const evidenceKinds = new Set<EvidenceKind>();
  const source: SourceReference = { type: "issue", key: issue.key };
  const sourceTitle = createIssueTitle(issue);
  const createdInRange = isDateInRange(issue.createdAt, range);
  if (createdInRange) {
    addEvidenceKinds(evidenceKinds, issue.bodyEvidenceKinds);
    if (issue.author != null && issue.authorIsHuman) {
      weightedOrigins.push({
        id: issue.key + ":issue:created",
        actor: issue.author,
        weight: 2,
        source,
        sourceTitle,
        reason: "Issue 作成、重み 2.00",
      });
      for (const [evidenceIndex, kind] of issue.bodyEvidenceKinds
        .slice(0, 4)
        .entries()) {
        weightedOrigins.push({
          id: issue.key + ":issue:body-evidence:" + evidenceIndex,
          actor: issue.author,
          weight: 1,
          source,
          sourceTitle,
          reason:
            "Issue 本文の証拠要素「" +
            evidenceKindLabel(kind) +
            "」、重み 1.00",
        });
      }
    }
  }

  const issueAuthorLogin = issue.author?.login.toLowerCase();
  const commentCounts = new Map<string, number>();
  const participants = new Set<string>();
  let substantiveCommentCount = 0;
  let hasCommentInRange = false;

  for (const [commentIndex, comment] of issue.comments.entries()) {
    if (isDateInRange(comment.createdAt, range) === false) {
      continue;
    }
    hasCommentInRange = true;
    if (comment.actor == null || comment.substantive === false) {
      continue;
    }

    substantiveCommentCount += 1;
    const loginKey = comment.actor.login.toLowerCase();
    if (loginKey !== issueAuthorLogin) {
      participants.add(loginKey);
    }
    addEvidenceKinds(evidenceKinds, comment.evidenceKinds);
    const previousCount = commentCounts.get(loginKey) ?? 0;
    commentCounts.set(loginKey, previousCount + 1);
    if (previousCount >= 3) {
      continue;
    }
    const decay = [1, 0.5, 0.25][previousCount];
    assertNonNullable(decay, "Issue コメントの逓減係数がありません。");
    const evidenceBonus = comment.evidenceKinds.some(
      (kind) =>
        kind === "codeOrLog" ||
        kind === "attachment" ||
        kind === "measurement",
    )
      ? 1
      : 0;
    const weight = (1 + evidenceBonus) * decay;
    weightedOrigins.push({
      id: issue.key + ":issue:comment:" + commentIndex,
      actor: comment.actor,
      weight,
      source,
      sourceTitle,
      reason:
        "実質的コメント " +
        (previousCount + 1) +
        " 件目、" +
        comment.createdAt +
        (evidenceBonus === 0 ? "" : "、添付・ログ・測定結果あり") +
        "、重み " +
        weight.toFixed(2),
    });
  }

  const closedInRange =
    issue.closedAt != null && isDateInRange(issue.closedAt, range);
  return {
    weightedOrigins,
    evidenceKinds,
    substantiveCommentCount,
    participantCount: participants.size,
    hasActivityInRange:
      createdInRange || hasCommentInRange || closedInRange,
  };
}

function calculateIssueStatusBonus(
  issue: PreparedIssue,
  activity: IssueActivity,
  range: DateRange,
): number {
  const closedInRange =
    issue.closedAt != null && isDateInRange(issue.closedAt, range);
  if (
    issue.state === "closed" &&
    issue.stateReason === "completed" &&
    closedInRange
  ) {
    return 2;
  }
  if (
    issue.state === "closed" &&
    issue.stateReason === "not_planned" &&
    closedInRange &&
    activity.evidenceKinds.size > 0
  ) {
    return 0.5;
  }
  if (isIssueOpenAtRangeEnd(issue, range)) {
    const enoughParticipants = activity.participantCount >= 2;
    const participantAndEvidence =
      activity.participantCount >= 1 && activity.evidenceKinds.size >= 2;
    const hasVerificationResult =
      activity.evidenceKinds.has("attachment") ||
      activity.evidenceKinds.has("measurement");
    if (
      enoughParticipants ||
      participantAndEvidence ||
      hasVerificationResult
    ) {
      return 1;
    }
  }
  return 0;
}

function isIssueOpenAtRangeEnd(
  issue: PreparedIssue,
  range: DateRange,
): boolean {
  if (issue.state === "open") {
    return true;
  }
  const closedAt = issue.closedAt;
  assertNonNullable(
    closedAt,
    issue.key + " は Close 済みですが closedAt がありません。",
  );
  return closedAt.slice(0, 10) > range.end;
}

function allocateIssueActivity(
  activity: IssueActivity,
  score: number,
): ScoreAllocation[] {
  const totalWeight = sum(
    activity.weightedOrigins.map((origin) => origin.weight),
  );
  if (totalWeight <= 0) {
    throw new Error("Issue 活動の配点重みが正の値ではありません。");
  }
  return activity.weightedOrigins.map((origin) =>
    createAllocation(
      origin.id,
      origin.actor,
      "issue",
      score * (origin.weight / totalWeight),
      origin.source,
      origin.sourceTitle,
      origin.reason,
    ),
  );
}

function addReviewEvent(
  events: Map<string, ReviewEvent[]>,
  event: ReviewEvent,
): void {
  const key = event.actor.login.toLowerCase();
  const current = events.get(key);
  if (current == null) {
    events.set(key, [event]);
    return;
  }
  current.push(event);
}

function createReviewOrigins(
  eventsByActor: Map<string, ReviewEvent[]>,
): ReviewOrigin[] {
  const origins: ReviewOrigin[] = [];
  for (const events of eventsByActor.values()) {
    events.sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
    const firstEvent = events[0];
    assertNonNullable(firstEvent, "レビュー活動の発生源がありません。");
    origins.push({
      id: firstEvent.id + ":participation",
      actor: firstEvent.actor,
      weight: 1,
      fullAiImplementation: firstEvent.fullAiImplementation,
      source: firstEvent.source,
      sourceTitle: firstEvent.sourceTitle,
      reason:
        "ワークストリームのレビュー参加、最初の活動 " +
        firstEvent.createdAt +
        "、重み 1.00",
    });

    let hasSummary = false;
    let threadCount = 0;
    for (const event of events) {
      if (
        event.type === "submission" &&
        event.hasSubstantiveSummary &&
        hasSummary === false
      ) {
        origins.push({
          id: event.id + ":summary",
          actor: event.actor,
          weight: 1,
          fullAiImplementation: event.fullAiImplementation,
          source: event.source,
          sourceTitle: event.sourceTitle,
          reason:
            "実質的なレビュー総評、" + event.createdAt + "、重み 1.00",
        });
        hasSummary = true;
      }
      if (event.type === "thread" && threadCount < 3) {
        origins.push({
          id: event.id,
          actor: event.actor,
          weight: 1,
          fullAiImplementation: event.fullAiImplementation,
          source: event.source,
          sourceTitle: event.sourceTitle,
          reason:
            "実質的なレビュースレッド " +
            (threadCount + 1) +
            " 件目、" +
            event.createdAt +
            "、重み 1.00",
        });
        threadCount += 1;
      }
    }
  }
  return origins;
}

function buildContributors(
  workstreams: WorkstreamScore[],
  standaloneAllocations: ScoreAllocation[],
): ContributorScore[] {
  const grouped = totalAllocations(workstreams, standaloneAllocations);
  const unranked = [...grouped.values()]
    .map((allocations) => buildContributor(allocations))
    .filter((contributor) => contributor.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.login.localeCompare(right.login),
    );

  let previousScore: number | undefined;
  let previousRank = 0;
  return unranked.map((contributor, index) => {
    const rank =
      previousScore != null && contributor.score === previousScore
        ? previousRank
        : index + 1;
    previousScore = contributor.score;
    previousRank = rank;
    return { ...contributor, rank };
  });
}

function buildContributor(
  allocations: ScoreAllocation[],
): Omit<ContributorScore, "rank"> {
  const first = allocations[0];
  assertNonNullable(first, "貢献者の配点がありません。");
  let implementationPoints = 0;
  let reviewPoints = 0;
  let issuePoints = 0;
  for (const allocation of allocations) {
    switch (allocation.kind) {
      case "implementation":
        implementationPoints += allocation.points;
        break;
      case "review":
        reviewPoints += allocation.points;
        break;
      case "issue":
        issuePoints += allocation.points;
        break;
      default:
        throw new UnreachableError(allocation.kind);
    }
  }
  return {
    ...first.actor,
    score: implementationPoints + reviewPoints + issuePoints,
    implementationPoints,
    reviewPoints,
    issuePoints,
    entries: allocations
      .map(toScoreEntry)
      .sort(
        (left, right) =>
          right.points - left.points || left.id.localeCompare(right.id),
      ),
  };
}

function toScoreEntry(allocation: ScoreAllocation): ScoreEntry {
  return {
    id: allocation.id,
    kind: allocation.kind,
    points: allocation.points,
    source: allocation.source,
    sourceTitle: allocation.sourceTitle,
    reason: allocation.reason,
  };
}

function createAllocation(
  id: string,
  actor: Actor,
  kind: ScoreAllocation["kind"],
  points: number,
  source: SourceReference,
  sourceTitle: string,
  reason: string,
): ScoreAllocation {
  if (points <= 0) {
    throw new Error("人物への配点が正の値ではありません。");
  }
  return {
    id,
    actor,
    kind,
    points,
    source,
    sourceTitle,
    reason,
  };
}

function createUnallocatedScore(
  id: string,
  kind: UnallocatedScore["kind"],
  points: number,
  source: SourceReference,
  sourceTitle: string,
  reason: string,
): UnallocatedScore {
  if (points <= 0) {
    throw new Error("配点対象外の点が正の値ではありません。");
  }
  return {
    id,
    kind,
    points,
    source,
    sourceTitle,
    reason,
  };
}

function createSourceReference(
  issue: PreparedIssue | undefined,
  pull: PreparedPull,
): SourceReference {
  if (issue != null) {
    return { type: "issue", key: issue.key };
  }
  return { type: "pull", key: pull.key };
}

function createSourceTitle(
  issue: PreparedIssue | undefined,
  pull: PreparedPull,
): string {
  if (issue != null) {
    return createIssueTitle(issue);
  }
  return pull.repository + "#" + pull.number + " " + pull.title;
}

function createIssueTitle(issue: PreparedIssue): string {
  return issue.repository + "#" + issue.number + " " + issue.title;
}

function createPullSource(pull: PreparedPull): SourceReference {
  return { type: "pull", key: pull.key };
}

function createPullTitle(pull: PreparedPull): string {
  return pull.repository + "#" + pull.number + " " + pull.title;
}

function toIssueReference(issue: PreparedIssue): IssueReference {
  return {
    key: issue.key,
    repository: issue.repository,
    number: issue.number,
    title: issue.title,
  };
}

function addEvidenceKinds(
  target: Set<EvidenceKind>,
  kinds: EvidenceKind[],
): void {
  for (const kind of kinds) {
    target.add(kind);
  }
}

function evidenceKindLabel(kind: EvidenceKind): string {
  switch (kind) {
    case "codeOrLog":
      return "コード・ログ";
    case "command":
      return "コマンド";
    case "attachment":
      return "添付";
    case "reference":
      return "外部参照";
    case "environment":
      return "実行環境";
    case "measurement":
      return "測定値";
    default:
      throw new UnreachableError(kind);
  }
}

function assertScoreConservation(
  importance: number,
  allocations: ScoreAllocation[],
  unallocatedEntries: UnallocatedScore[],
  workstreamKey: string,
): void {
  const traceIds = [
    ...allocations.map((allocation) => allocation.id),
    ...unallocatedEntries.map((entry) => entry.id),
  ];
  if (new Set(traceIds).size !== traceIds.length) {
    throw new Error(workstreamKey + " の配点追跡 ID が重複しています。");
  }
  const accountedPoints = sum([
    ...allocations.map((allocation) => allocation.points),
    ...unallocatedEntries.map((entry) => entry.points),
  ]);
  const tolerance = Math.max(1, importance) * 1e-10;
  if (Math.abs(importance - accountedPoints) > tolerance) {
    throw new Error(
      workstreamKey +
        " の重要度が人物への配点と配点対象外の点の合計と一致しません。重要度 " +
        importance +
        "、追跡済み " +
        accountedPoints,
    );
  }
}

function isDateInRange(timestamp: string, range: DateRange): boolean {
  const date = timestamp.slice(0, 10);
  return date >= range.start && date <= range.end;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function formatPercent(ratio: number): number {
  return Math.round(ratio * 100);
}
