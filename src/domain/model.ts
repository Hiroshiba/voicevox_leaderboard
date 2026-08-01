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

export interface CalculationScope {
  organization: string;
  repositories: string[];
  range: DateRange;
}

export interface Actor {
  login: string;
  avatarUrl: string;
  profileUrl: string;
}

export interface RepositoryOption {
  name: string;
  description: string;
  archived: boolean;
  fork: boolean;
}

export interface FileScore {
  filename: string;
  additions: number;
  deletions: number;
  effectiveLines: number;
  generated: boolean;
}

export interface PullScore {
  key: string;
  repository: string;
  number: number;
  title: string;
  url: string;
  author: Actor;
  coauthors: Actor[];
  files: FileScore[];
  effectiveLines: number;
  nonGeneratedFiles: number;
  mass: number;
  conventionalBonus: number;
}

export interface ScoreEntry {
  kind: ContributionKind;
  points: number;
  sourceKey: string;
  sourceTitle: string;
  sourceUrl: string;
  reason: string;
}

export interface ScoreAllocation extends ScoreEntry {
  actor: Actor;
}

export interface IssueReference {
  key: string;
  repository: string;
  number: number;
  title: string;
  url: string;
}

export interface WorkstreamScore {
  key: string;
  title: string;
  url: string;
  issue: IssueReference | undefined;
  pulls: PullScore[];
  effectiveLines: number;
  nonGeneratedFiles: number;
  repositoryCount: number;
  conventionalBonus: number;
  importance: number;
  implementationPoints: number;
  reviewPoints: number;
  issuePoints: number;
  allocations: ScoreAllocation[];
}

export interface StandaloneIssueScore {
  key: string;
  repository: string;
  number: number;
  title: string;
  url: string;
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

export interface RateLimit {
  limit: number;
  remaining: number;
  resetsAt: string;
}

export interface LeaderboardResult {
  scope: CalculationScope;
  calculatedAt: string;
  contributors: ContributorScore[];
  workstreams: WorkstreamScore[];
  standaloneIssues: StandaloneIssueScore[];
  requestCount: number;
  rateLimit: RateLimit | undefined;
  notices: string[];
}

export interface CalculationProgress {
  phase: "search" | "pulls" | "workstreams" | "issues" | "complete";
  message: string;
  completed: number;
  total: number;
}
