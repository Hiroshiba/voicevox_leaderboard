export type ContributionKind = "implementation" | "review" | "issue";

export type EvidenceKind =
  | "codeOrLog"
  | "command"
  | "attachment"
  | "reference"
  | "environment"
  | "measurement";

export interface DateRange {
  start: string;
  end: string;
}

export interface Actor {
  login: string;
  avatarUrl: string;
}

export interface RepositorySummary {
  nameWithOwner: string;
  fork: boolean;
  mirror: boolean;
  fullAiImplementation: boolean;
}

export interface EditGroup {
  fingerprint: string;
  beforeTokens: number;
  afterTokens: number;
  occurrences: number;
  weight: 0.5 | 1;
}

export type UnmeasuredReason =
  | "patchMissing"
  | "patchTruncated"
  | "binary"
  | "unsupported";

export type FileAnalysis =
  | { kind: "measured"; groups: EditGroup[] }
  | { kind: "generated" }
  | { kind: "unmeasured"; reason: UnmeasuredReason };

export interface FileScore {
  filename: string;
  additions: number;
  deletions: number;
  previousFilename?: string | undefined;
  sha?: string | undefined;
  analysis: FileAnalysis;
}

export type PreparedReviewState =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "COMMENTED";

export interface PreparedReview {
  actor: Actor;
  submittedAt: string;
  state: PreparedReviewState;
  hasSubstantiveSummary: boolean;
}

export interface PreparedReviewThread {
  actor: Actor;
  createdAt: string;
}

export type PullOutcome =
  | {
      kind: "merged";
      mergedAt: string;
      mergedBy: Actor;
      mergedByIsHuman: boolean;
    }
  | { kind: "closed"; closedAt: string }
  | { kind: "open" };

export interface PreparedPull {
  key: string;
  repository: string;
  number: number;
  title: string;
  githubUrl: string;
  createdAt: string;
  outcome: PullOutcome;
  author: Actor;
  authorIsHuman: boolean;
  coauthors: Actor[];
  files: FileScore[];
  conventionalBonus: number;
  fullAiImplementation: boolean;
  reviews: PreparedReview[];
  reviewThreads: PreparedReviewThread[];
  issueKey?: string | undefined;
}

export type PreparedMergedPull = PreparedPull & {
  outcome: Extract<PullOutcome, { kind: "merged" }>;
};

export interface PreparedIssueComment {
  actor?: Actor | undefined;
  createdAt: string;
  substantive: boolean;
  evidenceKinds: EvidenceKind[];
}

export interface PreparedIssue {
  key: string;
  repository: string;
  number: number;
  title: string;
  githubUrl: string;
  author?: Actor | undefined;
  authorIsHuman: boolean;
  state: "open" | "closed";
  stateReason?: string | undefined;
  createdAt: string;
  closedAt?: string | undefined;
  labels: string[];
  bodyEvidenceKinds: EvidenceKind[];
  comments: PreparedIssueComment[];
  activityCandidate: boolean;
}

export interface AcquisitionStats {
  networkRequests: number;
  cacheRevalidations: number;
  notModifiedResponses: number;
  remainingCoreRequests?: number | undefined;
  remainingSearchRequests?: number | undefined;
}

export interface LeaderboardDataset {
  schemaVersion: 5;
  organization: "VOICEVOX";
  generatedAt: string;
  range: DateRange;
  repositories: RepositorySummary[];
  pulls: PreparedPull[];
  issues: PreparedIssue[];
  notices: string[];
  acquisition: AcquisitionStats;
}

export interface SourceReference {
  type: "pull" | "issue";
  key: string;
}

export interface ScoreEntry {
  id: string;
  kind: ContributionKind;
  points: number;
  source: SourceReference;
  sourceTitle: string;
  reason: string;
}

export interface ScoreAllocation extends ScoreEntry {
  actor: Actor;
}

export type UnallocatedScore = ScoreEntry;

export interface IssueReference {
  key: string;
  repository: string;
  number: number;
  title: string;
}

export interface PullEditContribution {
  pullKey: string;
  amount: number;
}

export interface WorkstreamScore {
  key: string;
  title: string;
  source: SourceReference;
  issue?: IssueReference | undefined;
  pulls: PreparedPull[];
  uncompressedEditAmount: number;
  editAmount: number;
  generatedContribution: number;
  generatedFileCount: number;
  unmeasuredFileCount: number;
  unmeasuredReasons: Record<UnmeasuredReason, number>;
  pullEditContributions: PullEditContribution[];
  repositoryCount: number;
  conventionalBonus: number;
  importance: number;
  implementationPoints: number;
  reviewPoints: number;
  issuePoints: number;
  allocations: ScoreAllocation[];
  unallocatedPoints: number;
  unallocatedEntries: UnallocatedScore[];
}

export interface StandaloneIssueScore {
  key: string;
  repository: string;
  number: number;
  title: string;
  statusBonus: number;
  evidenceCount: number;
  substantiveCommentCount: number;
  participantCount: number;
  score: number;
  allocations: ScoreAllocation[];
}

export interface ContributorScore extends Actor {
  rank: number;
  score: number;
  implementationPoints: number;
  reviewPoints: number;
  issuePoints: number;
  entries: ScoreEntry[];
}

export interface LeaderboardResult {
  range: DateRange;
  contributors: ContributorScore[];
  workstreams: WorkstreamScore[];
  standaloneIssues: StandaloneIssueScore[];
}
