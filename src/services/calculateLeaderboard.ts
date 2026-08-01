import { assertNonNullable, UnreachableError } from "../domain/errors";
import {
  detectEvidenceKinds,
  isSubstantiveIssueText,
  isSubstantiveReviewText,
} from "../domain/evidence";
import type {
  Actor,
  CalculationProgress,
  CalculationScope,
  ContributorScore,
  DateRange,
  EvidenceKind,
  IssueReference,
  LeaderboardResult,
  PullScore,
  RepositoryOption,
  ScoreAllocation,
  ScoreEntry,
  StandaloneIssueScore,
  WorkstreamScore,
} from "../domain/model";
import {
  calculateConventionalBonus,
  calculateFileScore,
  calculateImportance,
  calculatePullMass,
  calculateStandaloneIssueScore,
  totalAllocations,
} from "../domain/scoring";
import { GitHubClient } from "./githubClient";
import type {
  GithubIssue,
  GithubIssueComment,
  GithubPull,
  GithubPullCommit,
  GithubPullReview,
  GithubReviewComment,
  GithubUser,
} from "./githubSchemas";
import {
  WorkstreamResolver,
  type ResolvedIssue,
} from "./workstreamResolver";

interface PullTarget {
  repository: string;
  number: number;
}

interface ProcessedPull {
  score: PullScore;
  pull: GithubPull;
  reviews: GithubPullReview[];
  reviewComments: GithubReviewComment[];
  authorIsHuman: boolean;
}

interface ResolvedPull {
  processed: ProcessedPull;
  issue: ResolvedIssue | undefined;
}

interface WorkstreamGroup {
  key: string;
  issue: ResolvedIssue | undefined;
  pulls: ProcessedPull[];
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

const acceptedReviewStates = new Set([
  "APPROVED",
  "CHANGES_REQUESTED",
  "COMMENTED",
]);

const standaloneNotices = [
  "Issue の作成、Close、コメントは選択期間内のイベントだけを配点します。期間をまたぐ加点履歴は保存しません。",
  "独立 Issue とマージ済み PR の関連判定は、今回計算したワークストリームを対象にします。期間外の PR との関連はプロトタイプでは追跡しません。",
  "古い Issue の本文編集日時は GitHub API から特定できないため、本文の証拠要素は Issue 作成日が選択期間内の場合だけ数えます。",
  "複数 PR の Conventional Commits 補正は、PR 分割による加点を防ぐため最大値を 1 回だけ使います。",
  "共同作者は GitHub がコミット作者へ関連付けたアカウントと、GitHub noreply 形式の Co-authored-by だけを自動解決します。",
];

/** Organization のリポジトリを選択肢として取得する。 */
export async function fetchRepositoryOptions(
  organization: string,
  token: string,
): Promise<RepositoryOption[]> {
  const client = new GitHubClient(token.trim());
  const repositories =
    await client.listOrganizationRepositories(organization.trim());
  return repositories
    .map((repository) => ({
      name: repository.name,
      description: repository.description ?? "",
      archived: repository.archived,
      fork: repository.fork || repository.mirror_url != null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** GitHub の実データから貢献者ランキングを計算する。 */
export async function calculateLeaderboard(
  scope: CalculationScope,
  token: string,
  onProgress: (progress: CalculationProgress) => void,
): Promise<LeaderboardResult> {
  const client = new GitHubClient(token.trim());
  const resolver = new WorkstreamResolver(client, scope.organization);

  onProgress({
    phase: "search",
    message: "マージ済み PR を検索しています",
    completed: 0,
    total: scope.repositories.length,
  });
  let searchedRepositories = 0;
  const pullTargetGroups = await mapWithConcurrency(
    scope.repositories,
    3,
    async (repository) => {
      const numbers = await client.searchMergedPullNumbers(
        repository,
        scope.range,
      );
      searchedRepositories += 1;
      onProgress({
        phase: "search",
        message: "マージ済み PR を検索しています",
        completed: searchedRepositories,
        total: scope.repositories.length,
      });
      return numbers.map((number) => ({ repository, number }));
    },
  );
  const pullTargets = pullTargetGroups.flat();

  onProgress({
    phase: "pulls",
    message: "PR の変更、レビュー、共同作者を取得しています",
    completed: 0,
    total: pullTargets.length,
  });
  let processedPullCount = 0;
  const processedPulls = await mapWithConcurrency(
    pullTargets,
    3,
    async (target) => {
      const processed = await processPull(client, target);
      processedPullCount += 1;
      onProgress({
        phase: "pulls",
        message: "PR の変更、レビュー、共同作者を取得しています",
        completed: processedPullCount,
        total: pullTargets.length,
      });
      return processed;
    },
  );

  onProgress({
    phase: "workstreams",
    message: "関連 Issue を解決しています",
    completed: 0,
    total: processedPulls.length,
  });
  let resolvedPullCount = 0;
  const resolvedPulls = await mapWithConcurrency(
    processedPulls,
    3,
    async (processed) => {
      const issue = await resolver.resolve({
        repository: processed.score.repository,
        pull: processed.pull,
      });
      resolvedPullCount += 1;
      onProgress({
        phase: "workstreams",
        message: "関連 Issue を解決しています",
        completed: resolvedPullCount,
        total: processedPulls.length,
      });
      return { processed, issue };
    },
  );
  const groups = groupWorkstreams(resolvedPulls);

  onProgress({
    phase: "workstreams",
    message: "ワークストリームの点数を計算しています",
    completed: 0,
    total: groups.length,
  });
  let calculatedWorkstreamCount = 0;
  const workstreams = await mapWithConcurrency(groups, 3, async (group) => {
    const workstream = await calculateWorkstream(group, resolver, scope.range);
    calculatedWorkstreamCount += 1;
    onProgress({
      phase: "workstreams",
      message: "ワークストリームの点数を計算しています",
      completed: calculatedWorkstreamCount,
      total: groups.length,
    });
    return workstream;
  });
  workstreams.sort(
    (left, right) =>
      right.importance - left.importance || left.key.localeCompare(right.key),
  );

  const linkedIssueKeys = new Set(
    groups
      .map((group) => group.issue?.key)
      .filter((key): key is string => key != null),
  );
  const standaloneIssues = await calculateStandaloneIssues(
    client,
    resolver,
    scope,
    linkedIssueKeys,
    onProgress,
  );
  standaloneIssues.sort(
    (left, right) =>
      right.score - left.score || left.key.localeCompare(right.key),
  );

  const standaloneAllocations = standaloneIssues.flatMap(
    (issue) => issue.allocations,
  );
  const contributors = buildContributors(workstreams, standaloneAllocations);

  onProgress({
    phase: "complete",
    message: "計算が完了しました",
    completed: 1,
    total: 1,
  });

  return {
    scope,
    calculatedAt: new Date().toISOString(),
    contributors,
    workstreams,
    standaloneIssues,
    requestCount: client.getRequestCount(),
    rateLimit: client.getRateLimit(),
    notices: standaloneNotices,
  };
}

async function processPull(
  client: GitHubClient,
  target: PullTarget,
): Promise<ProcessedPull> {
  const pull = await client.getPull(target.repository, target.number);
  const mergedAt = pull.merged_at;
  assertNonNullable(
    mergedAt,
    target.repository +
      "#" +
      target.number +
      " はマージ済み検索結果ですが merged_at がありません。",
  );
  const pullAuthor = pull.user;
  assertNonNullable(
    pullAuthor,
    target.repository +
      "#" +
      target.number +
      " の作者アカウントを取得できません。",
  );

  const [rawFiles, reviews, reviewComments, commits] = await Promise.all([
    client.getPullFiles(
      target.repository,
      target.number,
      pull.changed_files,
    ),
    client.getPullReviews(target.repository, target.number),
    client.getReviewComments(target.repository, target.number),
    client.getPullCommits(target.repository, target.number),
  ]);

  const files = rawFiles.map(calculateFileScore);
  const effectiveLines = sum(files.map((file) => file.effectiveLines));
  const nonGeneratedFiles = files.filter(
    (file) => file.generated === false,
  ).length;
  const coauthors = extractCoauthors(commits, pullAuthor.login);
  const body = pull.body ?? "";
  const conventionalBonus = calculateConventionalBonus(
    pull.title,
    body,
    pull.labels.map((label) => label.name),
  );

  return {
    score: {
      key: target.repository.toLowerCase() + "#" + target.number,
      repository: target.repository,
      number: target.number,
      title: pull.title,
      url: pull.html_url,
      author: toActor(pullAuthor),
      coauthors,
      files,
      effectiveLines,
      nonGeneratedFiles,
      mass: calculatePullMass(effectiveLines, nonGeneratedFiles),
      conventionalBonus,
    },
    pull,
    reviews,
    reviewComments,
    authorIsHuman: isHumanUser(pullAuthor),
  };
}

function extractCoauthors(
  commits: GithubPullCommit[],
  pullAuthorLogin: string,
): Actor[] {
  const actors = new Map<string, Actor>();
  for (const commit of commits) {
    if (commit.author != null && isHumanUser(commit.author)) {
      addCoauthor(actors, toActor(commit.author), pullAuthorLogin);
    }
    for (const match of commit.commit.message.matchAll(
      /^Co-authored-by:\s*[^<\n]+<(?:(?:\d+)\+)?([A-Za-z0-9-]+)@users\.noreply\.github\.com>\s*$/gim,
    )) {
      const login = match[1];
      assertNonNullable(login, "共同作者の GitHub ログインを取得できません。");
      if (isBotLogin(login) === false) {
        addCoauthor(actors, actorFromLogin(login), pullAuthorLogin);
      }
    }
  }
  return [...actors.values()].sort((left, right) =>
    left.login.localeCompare(right.login),
  );
}

function addCoauthor(
  actors: Map<string, Actor>,
  actor: Actor,
  pullAuthorLogin: string,
): void {
  if (actor.login.toLowerCase() === pullAuthorLogin.toLowerCase()) {
    return;
  }
  actors.set(actor.login.toLowerCase(), actor);
}

function groupWorkstreams(resolvedPulls: ResolvedPull[]): WorkstreamGroup[] {
  const groups = new Map<string, WorkstreamGroup>();
  for (const resolved of resolvedPulls) {
    const key =
      resolved.issue?.key ?? "pr:" + resolved.processed.score.key.toLowerCase();
    const current = groups.get(key);
    if (current == null) {
      groups.set(key, {
        key,
        issue: resolved.issue,
        pulls: [resolved.processed],
      });
    } else {
      current.pulls.push(resolved.processed);
    }
  }
  return [...groups.values()];
}

async function calculateWorkstream(
  group: WorkstreamGroup,
  resolver: WorkstreamResolver,
  range: DateRange,
): Promise<WorkstreamScore> {
  const pulls = group.pulls.map((processed) => processed.score);
  const effectiveLines = sum(pulls.map((pull) => pull.effectiveLines));
  const nonGeneratedFiles = sum(
    pulls.map((pull) => pull.nonGeneratedFiles),
  );
  const repositoryCount = new Set(pulls.map((pull) => pull.repository)).size;
  const conventionalBonus = Math.max(
    ...pulls.map((pull) => pull.conventionalBonus),
  );
  const importance = calculateImportance({
    effectiveLines,
    nonGeneratedFiles,
    repositoryCount,
    conventionalBonus,
  });
  const issueReference = toIssueReference(group.issue);
  const title = issueReference?.title ?? pulls[0]?.title;
  const url = issueReference?.url ?? pulls[0]?.url;
  assertNonNullable(title, "ワークストリームのタイトルがありません。");
  assertNonNullable(url, "ワークストリームの URL がありません。");

  const implementationAllocations = allocateImplementation(
    group,
    importance,
    title,
    url,
  );
  const reviewAllocations = allocateReviews(
    group,
    importance,
    range,
    title,
    url,
  );
  const issueAllocations = await allocateLinkedIssue(
    group,
    resolver,
    importance,
    range,
    title,
    url,
  );
  const allocations = [
    ...implementationAllocations,
    ...reviewAllocations,
    ...issueAllocations,
  ];

  return {
    key: group.key,
    title,
    url,
    issue: issueReference,
    pulls,
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
    allocations,
  };
}

function allocateImplementation(
  group: WorkstreamGroup,
  importance: number,
  sourceTitle: string,
  sourceUrl: string,
): ScoreAllocation[] {
  const totalMass = sum(group.pulls.map((pull) => pull.score.mass));
  const allocations: ScoreAllocation[] = [];
  for (const processed of group.pulls) {
    const pullPool = 0.65 * importance * (processed.score.mass / totalMass);
    const reason =
      processed.score.repository +
      "#" +
      processed.score.number +
      " の実装質量 " +
      processed.score.mass.toFixed(2) +
      " による配分";
    if (processed.authorIsHuman) {
      const authorRatio = processed.score.coauthors.length > 0 ? 0.7 : 1;
      allocations.push(
        createAllocation(
          processed.score.author,
          "implementation",
          pullPool * authorRatio,
          group.key,
          sourceTitle,
          sourceUrl,
          reason,
        ),
      );
    }

    if (processed.score.coauthors.length > 0) {
      const coauthorPool = pullPool * 0.3;
      for (const coauthor of processed.score.coauthors) {
        allocations.push(
          createAllocation(
            coauthor,
            "implementation",
            coauthorPool / processed.score.coauthors.length,
            group.key,
            sourceTitle,
            sourceUrl,
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
  sourceTitle: string,
  sourceUrl: string,
): ScoreAllocation[] {
  const activities = new Map<string, ReviewActivity>();
  for (const processed of group.pulls) {
    const authorLogin = processed.score.author.login.toLowerCase();
    for (const review of processed.reviews) {
      if (
        review.user == null ||
        isHumanUser(review.user) === false ||
        review.user.login.toLowerCase() === authorLogin ||
        review.submitted_at == null ||
        isDateInRange(review.submitted_at, range) === false ||
        acceptedReviewStates.has(review.state.toUpperCase()) === false
      ) {
        continue;
      }
      const activity = getReviewActivity(activities, review.user);
      if (
        review.body != null &&
        isSubstantiveReviewText(review.body)
      ) {
        activity.hasSummary = true;
      }
    }

    for (const comment of processed.reviewComments) {
      if (
        comment.user == null ||
        isHumanUser(comment.user) === false ||
        comment.user.login.toLowerCase() === authorLogin ||
        isDateInRange(comment.created_at, range) === false ||
        comment.in_reply_to_id != null ||
        isSubstantiveReviewText(comment.body) === false
      ) {
        continue;
      }
      const activity = getReviewActivity(activities, comment.user);
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
  const reviewPool =
    0.2 * importance * Math.min(1, totalWeight / 5);
  return weights.map(({ activity, value }) =>
    createAllocation(
      activity.actor,
      "review",
      reviewPool * (value / totalWeight),
      group.key,
      sourceTitle,
      sourceUrl,
      "レビュー重み V=" + value,
    ),
  );
}

async function allocateLinkedIssue(
  group: WorkstreamGroup,
  resolver: WorkstreamResolver,
  importance: number,
  range: DateRange,
  sourceTitle: string,
  sourceUrl: string,
): Promise<ScoreAllocation[]> {
  if (group.issue == null) {
    return [];
  }
  const comments = await resolver.getIssueComments(
    group.issue.repository,
    group.issue.issue.number,
  );
  const activity = analyzeIssueActivity(group.issue.issue, comments, range);
  const totalWeight = sum(
    activity.weightedActors.map((participant) => participant.weight),
  );
  if (totalWeight === 0) {
    return [];
  }
  return allocateIssueActivity(
    activity,
    0.15 * importance,
    group.key,
    sourceTitle,
    sourceUrl,
  );
}

async function calculateStandaloneIssues(
  client: GitHubClient,
  resolver: WorkstreamResolver,
  scope: CalculationScope,
  linkedIssueKeys: Set<string>,
  onProgress: (progress: CalculationProgress) => void,
): Promise<StandaloneIssueScore[]> {
  onProgress({
    phase: "issues",
    message: "期間内に活動があった Issue を検索しています",
    completed: 0,
    total: scope.repositories.length,
  });
  let searchedRepositories = 0;
  const targetGroups = await mapWithConcurrency(
    scope.repositories,
    3,
    async (repository) => {
      const numbers = await client.searchUpdatedIssueNumbers(
        repository,
        scope.range,
      );
      searchedRepositories += 1;
      onProgress({
        phase: "issues",
        message: "期間内に活動があった Issue を検索しています",
        completed: searchedRepositories,
        total: scope.repositories.length,
      });
      return numbers.map((number) => ({ repository, number }));
    },
  );
  const targets = targetGroups.flat();

  onProgress({
    phase: "issues",
    message: "独立 Issue の点数を計算しています",
    completed: 0,
    total: targets.length,
  });
  let completed = 0;
  const scores = await mapWithConcurrency(targets, 3, async (target) => {
    const result = await calculateStandaloneIssue(
      client,
      resolver,
      target,
      scope.range,
      linkedIssueKeys,
    );
    completed += 1;
    onProgress({
      phase: "issues",
      message: "独立 Issue の点数を計算しています",
      completed,
      total: targets.length,
    });
    return result;
  });
  return scores.filter(
    (score): score is StandaloneIssueScore => score != null,
  );
}

async function calculateStandaloneIssue(
  client: GitHubClient,
  resolver: WorkstreamResolver,
  target: PullTarget,
  range: DateRange,
  linkedIssueKeys: Set<string>,
): Promise<StandaloneIssueScore | undefined> {
  const issue = await resolver.getIssue(target.repository, target.number);
  const key = target.repository.toLowerCase() + "#" + target.number;
  if (issue.pull_request != null || linkedIssueKeys.has(key)) {
    return undefined;
  }
  const labelNames = issue.labels.map((label) => label.name.toLowerCase());
  if (
    labelNames.some(
      (label) => label === "invalid" || label === "spam",
    )
  ) {
    return undefined;
  }

  const comments = await client.getIssueComments(
    target.repository,
    target.number,
  );
  const activity = analyzeIssueActivity(issue, comments, range);
  if (activity.hasActivityInRange === false) {
    return undefined;
  }

  const statusBonus = calculateIssueStatusBonus(issue, activity, range);
  const openIssueIsEligible =
    issue.state !== "open" ||
    statusBonus > 0;
  if (openIssueIsEligible === false) {
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
  const sourceTitle =
    target.repository + "#" + target.number + " " + issue.title;
  const allocations = allocateIssueActivity(
    activity,
    score,
    key,
    sourceTitle,
    issue.html_url,
  );

  return {
    key,
    repository: target.repository,
    number: target.number,
    title: issue.title,
    url: issue.html_url,
    statusBonus,
    evidenceCount: activity.evidenceKinds.size,
    substantiveCommentCount: activity.substantiveCommentCount,
    participantCount: activity.participantCount,
    score,
    allocations,
  };
}

function analyzeIssueActivity(
  issue: GithubIssue,
  comments: GithubIssueComment[],
  range: DateRange,
): IssueActivity {
  const weightedActors = new Map<string, WeightedActor>();
  const evidenceKinds = new Set<EvidenceKind>();
  const body = issue.body ?? "";
  const createdInRange = isDateInRange(issue.created_at, range);
  if (createdInRange) {
    const bodyEvidence = detectEvidenceKinds(body);
    addEvidenceKinds(evidenceKinds, bodyEvidence);
    if (issue.user != null && isHumanUser(issue.user)) {
      addIssueWeight(
        weightedActors,
        toActor(issue.user),
        2 + Math.min(bodyEvidence.length, 4),
        true,
      );
    }
  }

  const issueAuthorLogin = issue.user?.login.toLowerCase();
  const commentCounts = new Map<string, number>();
  const participants = new Set<string>();
  let substantiveCommentCount = 0;
  let hasCommentInRange = false;
  const sortedComments = [...comments].sort((left, right) =>
    left.created_at.localeCompare(right.created_at),
  );

  for (const comment of sortedComments) {
    if (isDateInRange(comment.created_at, range) === false) {
      continue;
    }
    hasCommentInRange = true;
    if (
      comment.user == null ||
      isHumanUser(comment.user) === false ||
      isSubstantiveIssueText(comment.body) === false
    ) {
      continue;
    }

    substantiveCommentCount += 1;
    const loginKey = comment.user.login.toLowerCase();
    if (loginKey !== issueAuthorLogin) {
      participants.add(loginKey);
    }
    const commentEvidence = detectEvidenceKinds(comment.body);
    addEvidenceKinds(evidenceKinds, commentEvidence);

    const previousCount = commentCounts.get(loginKey) ?? 0;
    commentCounts.set(loginKey, previousCount + 1);
    if (previousCount >= 3) {
      continue;
    }
    const decay = [1, 0.5, 0.25][previousCount];
    assertNonNullable(decay, "Issue コメントの逓減係数がありません。");
    const evidenceBonus = commentEvidence.some(
      (kind) =>
        kind === "codeOrLog" ||
        kind === "attachment" ||
        kind === "measurement",
    )
      ? 1
      : 0;
    addIssueWeight(
      weightedActors,
      toActor(comment.user),
      (1 + evidenceBonus) * decay,
      false,
    );
  }

  const closedInRange =
    issue.closed_at != null && isDateInRange(issue.closed_at, range);
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
  issue: GithubIssue,
  activity: IssueActivity,
  range: DateRange,
): number {
  const closedInRange =
    issue.closed_at != null && isDateInRange(issue.closed_at, range);
  if (
    issue.state === "closed" &&
    issue.state_reason === "completed" &&
    closedInRange
  ) {
    return 2;
  }
  if (
    issue.state === "closed" &&
    issue.state_reason === "not_planned" &&
    closedInRange &&
    activity.evidenceKinds.size > 0
  ) {
    return 0.5;
  }
  if (issue.state === "open") {
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

function allocateIssueActivity(
  activity: IssueActivity,
  score: number,
  sourceKey: string,
  sourceTitle: string,
  sourceUrl: string,
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
      sourceKey,
      sourceTitle,
      sourceUrl,
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
  user: GithubUser,
): ReviewActivity {
  const key = user.login.toLowerCase();
  const current = activities.get(key);
  if (current != null) {
    return current;
  }
  const activity: ReviewActivity = {
    actor: toActor(user),
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
    entries: allocations.map(toScoreEntry).sort(
      (left, right) => right.points - left.points,
    ),
  };
}

function toScoreEntry(allocation: ScoreAllocation): ScoreEntry {
  return {
    kind: allocation.kind,
    points: allocation.points,
    sourceKey: allocation.sourceKey,
    sourceTitle: allocation.sourceTitle,
    sourceUrl: allocation.sourceUrl,
    reason: allocation.reason,
  };
}

function toIssueReference(
  resolved: ResolvedIssue | undefined,
): IssueReference | undefined {
  if (resolved == null) {
    return undefined;
  }
  return {
    key: resolved.key,
    repository: resolved.repository,
    number: resolved.issue.number,
    title: resolved.issue.title,
    url: resolved.issue.html_url,
  };
}

function createAllocation(
  actor: Actor,
  kind: ScoreAllocation["kind"],
  points: number,
  sourceKey: string,
  sourceTitle: string,
  sourceUrl: string,
  reason: string,
): ScoreAllocation {
  return {
    actor,
    kind,
    points,
    sourceKey,
    sourceTitle,
    sourceUrl,
    reason,
  };
}

function toActor(user: GithubUser): Actor {
  return {
    login: user.login,
    avatarUrl: user.avatar_url,
    profileUrl: user.html_url,
  };
}

function actorFromLogin(login: string): Actor {
  return {
    login,
    avatarUrl: "https://github.com/" + login + ".png?size=96",
    profileUrl: "https://github.com/" + login,
  };
}

function isHumanUser(user: GithubUser): boolean {
  return user.type === "User" && isBotLogin(user.login) === false;
}

function isBotLogin(login: string): boolean {
  return /\[bot\]$|(?:^|[-_])bot$/i.test(login);
}

function isDateInRange(timestamp: string, range: DateRange): boolean {
  const date = timestamp.slice(0, 10);
  return date >= range.start && date <= range.end;
}

function addEvidenceKinds(
  target: Set<EvidenceKind>,
  kinds: EvidenceKind[],
): void {
  for (const kind of kinds) {
    target.add(kind);
  }
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  callback: (value: T) => Promise<R>,
): Promise<R[]> {
  if (concurrency <= 0) {
    throw new Error("並列数は正の整数で指定してください。");
  }
  let nextIndex = 0;
  const results: Array<{ index: number; value: R }> = [];
  const workerCount = Math.min(concurrency, values.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      const value = values[index];
      assertNonNullable(value, "並列処理の対象がありません。");
      results.push({ index, value: await callback(value) });
    }
  });
  await Promise.all(workers);
  return results
    .sort((left, right) => left.index - right.index)
    .map((result) => result.value);
}
