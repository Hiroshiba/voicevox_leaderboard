import { assertNonNullable, UnreachableError } from "../domain/errors.ts";
import type {
  Actor,
  ContributorScore,
  DateRange,
  EvidenceKind,
  IssueReference,
  LeaderboardDataset,
  LeaderboardResult,
  PreparedIssue,
  PreparedPull,
  ScoreAllocation,
  ScoreEntry,
  SourceReference,
  StandaloneIssueScore,
  WorkstreamScore,
} from "../domain/model.ts";
import {
  calculateImportance,
  calculateStandaloneIssueScore,
  totalAllocations,
} from "../domain/scoring.ts";
import { parseDateRange } from "./calculationScope.ts";

interface WorkstreamGroup {
  key: string;
  issue?: PreparedIssue;
  pulls: PreparedPull[];
}

interface WeightedActor {
  actor: Actor;
  weight: number;
  createdIssue: boolean;
  substantiveComments: number;
}

interface IssueActivity {
  weightedActors: WeightedActor[];
  evidenceKinds: Set<EvidenceKind>;
  substantiveCommentCount: number;
  participantCount: number;
  hasActivityInRange: boolean;
}

interface ReviewActivity {
  actor: Actor;
  threadCount: number;
  hasSummary: boolean;
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
  const pulls = dataset.pulls.filter((pull) =>
    isDateInRange(pull.mergedAt, range),
  );
  const groups = groupWorkstreams(pulls, issueByKey);
  const workstreams = groups
    .map((group) => calculateWorkstream(group, range))
    .sort(
      (left, right) =>
        right.importance - left.importance ||
        left.key.localeCompare(right.key),
    );

  const linkedIssueKeys = new Set(
    groups
      .map((group) => group.issue?.key)
      .filter((key): key is string => key != null),
  );
  const standaloneIssues = dataset.issues
    .map((issue) =>
      calculateStandaloneIssue(issue, range, linkedIssueKeys),
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

function groupWorkstreams(
  pulls: PreparedPull[],
  issueByKey: Map<string, PreparedIssue>,
): WorkstreamGroup[] {
  const groups = new Map<string, WorkstreamGroup>();
  for (const pull of pulls) {
    const key = pull.issueKey ?? "pr:" + pull.key;
    const current = groups.get(key);
    if (current != null) {
      current.pulls.push(pull);
      continue;
    }

    if (pull.issueKey == null) {
      groups.set(key, { key, pulls: [pull] });
      continue;
    }
    const issue = issueByKey.get(pull.issueKey);
    assertNonNullable(
      issue,
      pull.key + " の関連 Issue が事前取得データにありません。",
    );
    groups.set(key, { key, issue, pulls: [pull] });
  }
  return [...groups.values()];
}

function calculateWorkstream(
  group: WorkstreamGroup,
  range: DateRange,
): WorkstreamScore {
  const effectiveLines = sum(
    group.pulls.map((pull) => pull.effectiveLines),
  );
  const nonGeneratedFiles = sum(
    group.pulls.map((pull) => pull.nonGeneratedFiles),
  );
  const repositoryCount = new Set(
    group.pulls.map((pull) => pull.repository.toLowerCase()),
  ).size;
  const conventionalBonus = Math.max(
    ...group.pulls.map((pull) => pull.conventionalBonus),
  );
  const importance = calculateImportance({
    effectiveLines,
    nonGeneratedFiles,
    repositoryCount,
    conventionalBonus,
  });
  const firstPull = group.pulls[0];
  assertNonNullable(firstPull, "ワークストリームに PR がありません。");
  const title = group.issue?.title ?? firstPull.title;
  const source = createSourceReference(group.issue, firstPull);
  const sourceTitle = createSourceTitle(group.issue, firstPull);
  const implementationAllocations = allocateImplementation(
    group,
    importance,
    source,
    sourceTitle,
  );
  const reviewAllocations = allocateReviews(
    group,
    importance,
    range,
    source,
    sourceTitle,
  );
  const issueAllocations = allocateLinkedIssue(
    group,
    importance,
    range,
    source,
    sourceTitle,
  );

  return {
    key: group.key,
    title,
    source,
    ...(group.issue == null ? {} : { issue: toIssueReference(group.issue) }),
    pulls: group.pulls,
    effectiveLines,
    nonGeneratedFiles,
    repositoryCount,
    conventionalBonus,
    importance,
    implementationPoints: sum(
      implementationAllocations.map((allocation) => allocation.points),
    ),
    reviewPoints: sum(
      reviewAllocations.map((allocation) => allocation.points),
    ),
    issuePoints: sum(
      issueAllocations.map((allocation) => allocation.points),
    ),
    allocations: [
      ...implementationAllocations,
      ...reviewAllocations,
      ...issueAllocations,
    ],
  };
}

function allocateImplementation(
  group: WorkstreamGroup,
  importance: number,
  source: SourceReference,
  sourceTitle: string,
): ScoreAllocation[] {
  const totalMass = sum(group.pulls.map((pull) => pull.mass));
  if (totalMass <= 0) {
    throw new Error("ワークストリームの実装質量が正の値ではありません。");
  }

  const allocations: ScoreAllocation[] = [];
  for (const pull of group.pulls) {
    const pullPool = 0.65 * importance * (pull.mass / totalMass);
    const reason =
      pull.repository +
      "#" +
      pull.number +
      " の実装質量 " +
      pull.mass.toFixed(2) +
      " による配分";
    if (pull.authorIsHuman) {
      const authorRatio = pull.coauthors.length > 0 ? 0.7 : 1;
      allocations.push(
        createAllocation(
          pull.author,
          "implementation",
          pullPool * authorRatio,
          source,
          sourceTitle,
          reason,
        ),
      );
    }

    if (pull.coauthors.length > 0) {
      const coauthorPool = pullPool * 0.3;
      for (const coauthor of pull.coauthors) {
        allocations.push(
          createAllocation(
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
  return allocations;
}

function allocateReviews(
  group: WorkstreamGroup,
  importance: number,
  range: DateRange,
  source: SourceReference,
  sourceTitle: string,
): ScoreAllocation[] {
  const activities = new Map<string, ReviewActivity>();
  for (const pull of group.pulls) {
    for (const review of pull.reviews) {
      if (isDateInRange(review.submittedAt, range) === false) {
        continue;
      }
      const activity = getReviewActivity(activities, review.actor);
      if (review.hasSubstantiveSummary) {
        activity.hasSummary = true;
      }
    }
    for (const thread of pull.reviewThreads) {
      if (isDateInRange(thread.createdAt, range) === false) {
        continue;
      }
      const activity = getReviewActivity(activities, thread.actor);
      activity.threadCount += 1;
    }
  }

  const weights = [...activities.values()].map((activity) => ({
    activity,
    value:
      1 +
      Math.min(3, activity.threadCount) +
      (activity.hasSummary ? 1 : 0),
  }));
  const totalWeight = sum(weights.map((weight) => weight.value));
  if (totalWeight === 0) {
    return [];
  }
  const reviewPool = 0.2 * importance * Math.min(1, totalWeight / 5);
  return weights.map(({ activity, value }) =>
    createAllocation(
      activity.actor,
      "review",
      reviewPool * (value / totalWeight),
      source,
      sourceTitle,
      "レビュー重み V=" + value,
    ),
  );
}

function allocateLinkedIssue(
  group: WorkstreamGroup,
  importance: number,
  range: DateRange,
  source: SourceReference,
  sourceTitle: string,
): ScoreAllocation[] {
  if (group.issue == null) {
    return [];
  }
  const activity = analyzeIssueActivity(group.issue, range);
  const totalWeight = sum(
    activity.weightedActors.map((participant) => participant.weight),
  );
  if (totalWeight === 0) {
    return [];
  }
  return allocateIssueActivity(
    activity,
    0.15 * importance,
    source,
    sourceTitle,
  );
}

function calculateStandaloneIssue(
  issue: PreparedIssue,
  range: DateRange,
  linkedIssueKeys: Set<string>,
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
  );
  const totalWeight = sum(
    activity.weightedActors.map((participant) => participant.weight),
  );
  if (score === 0 || totalWeight === 0) {
    return undefined;
  }
  const source: SourceReference = { type: "issue", key: issue.key };
  const sourceTitle = createIssueTitle(issue);
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
    allocations: allocateIssueActivity(
      activity,
      score,
      source,
      sourceTitle,
    ),
  };
}

function analyzeIssueActivity(
  issue: PreparedIssue,
  range: DateRange,
): IssueActivity {
  const weightedActors = new Map<string, WeightedActor>();
  const evidenceKinds = new Set<EvidenceKind>();
  const createdInRange = isDateInRange(issue.createdAt, range);
  if (createdInRange) {
    addEvidenceKinds(evidenceKinds, issue.bodyEvidenceKinds);
    if (issue.author != null && issue.authorIsHuman) {
      addIssueWeight(
        weightedActors,
        issue.author,
        2 + Math.min(issue.bodyEvidenceKinds.length, 4),
        true,
      );
    }
  }

  const issueAuthorLogin = issue.author?.login.toLowerCase();
  const commentCounts = new Map<string, number>();
  const participants = new Set<string>();
  let substantiveCommentCount = 0;
  let hasCommentInRange = false;

  for (const comment of issue.comments) {
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
    addIssueWeight(
      weightedActors,
      comment.actor,
      (1 + evidenceBonus) * decay,
      false,
    );
  }

  const closedInRange =
    issue.closedAt != null && isDateInRange(issue.closedAt, range);
  return {
    weightedActors: [...weightedActors.values()],
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
  source: SourceReference,
  sourceTitle: string,
): ScoreAllocation[] {
  const totalWeight = sum(
    activity.weightedActors.map((participant) => participant.weight),
  );
  if (totalWeight === 0) {
    return [];
  }
  return activity.weightedActors.map((participant) => {
    const reasons: string[] = [];
    if (participant.createdIssue) {
      reasons.push("Issue 作成");
    }
    if (participant.substantiveComments > 0) {
      reasons.push(
        "実質的コメント " + participant.substantiveComments + " 件",
      );
    }
    return createAllocation(
      participant.actor,
      "issue",
      score * (participant.weight / totalWeight),
      source,
      sourceTitle,
      reasons.join("、") + "、重み " + participant.weight.toFixed(2),
    );
  });
}

function addIssueWeight(
  participants: Map<string, WeightedActor>,
  actor: Actor,
  weight: number,
  createdIssue: boolean,
): void {
  const key = actor.login.toLowerCase();
  const current = participants.get(key);
  if (current == null) {
    participants.set(key, {
      actor,
      weight,
      createdIssue,
      substantiveComments: createdIssue ? 0 : 1,
    });
    return;
  }
  current.weight += weight;
  current.createdIssue = current.createdIssue || createdIssue;
  if (createdIssue === false) {
    current.substantiveComments += 1;
  }
}

function getReviewActivity(
  activities: Map<string, ReviewActivity>,
  actor: Actor,
): ReviewActivity {
  const key = actor.login.toLowerCase();
  const current = activities.get(key);
  if (current != null) {
    return current;
  }
  const activity: ReviewActivity = {
    actor,
    threadCount: 0,
    hasSummary: false,
  };
  activities.set(key, activity);
  return activity;
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
      .sort((left, right) => right.points - left.points),
  };
}

function toScoreEntry(allocation: ScoreAllocation): ScoreEntry {
  return {
    kind: allocation.kind,
    points: allocation.points,
    source: allocation.source,
    sourceTitle: allocation.sourceTitle,
    reason: allocation.reason,
  };
}

function createAllocation(
  actor: Actor,
  kind: ScoreAllocation["kind"],
  points: number,
  source: SourceReference,
  sourceTitle: string,
  reason: string,
): ScoreAllocation {
  return {
    actor,
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

function isDateInRange(timestamp: string, range: DateRange): boolean {
  const date = timestamp.slice(0, 10);
  return date >= range.start && date <= range.end;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
