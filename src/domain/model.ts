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
}

export interface FileScore {
  filename: string;
  additions: number;
  deletions: number;
  effectiveLines: number;
  generated: boolean;
}

export interface PreparedReview {
  actor: Actor;
  submittedAt: string;
  hasSubstantiveSummary: boolean;
}

export interface PreparedReviewThread {
  actor: Actor;
  createdAt: string;
}

export interface PreparedPull {
  key: string;
  repository: string;
  number: number;
  title: string;
  githubUrl: string;
  mergedAt: string;
  author: Actor;
  authorIsHuman: boolean;
  coauthors: Actor[];
  files: FileScore[];
  effectiveLines: number;
  nonGeneratedFiles: number;
  mass: number;
  conventionalBonus: number;
  reviews: PreparedReview[];
  reviewThreads: PreparedReviewThread[];
  issueKey?: string | undefined;
}

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
  schemaVersion: 1;
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

export interface WorkstreamScore {
  key: string;
  title: string;
  source: SourceReference;
  issue?: IssueReference | undefined;
  pulls: PreparedPull[];
  effectiveLines: number;
  nonGeneratedFiles: number;
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
