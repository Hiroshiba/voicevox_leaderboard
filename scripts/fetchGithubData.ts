import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { leaderboardDatasetSchema } from "../src/domain/dataset.ts";
import { assertNonNullable } from "../src/domain/errors.ts";
import {
  detectEvidenceKinds,
  isSubstantiveIssueText,
  isSubstantiveReviewText,
} from "../src/domain/evidence.ts";
import type {
  Actor,
  DateRange,
  LeaderboardDataset,
  PreparedIssue,
  PreparedPull,
  PreparedReviewState,
} from "../src/domain/model.ts";
import {
  extractClosingReferences,
  extractGithubReferences,
  extractRelatedIssueReferences,
  type GithubReference,
} from "../src/domain/references.ts";
import {
  calculateConventionalBonus,
  calculateFileScore,
  calculatePullMass,
} from "../src/domain/scoring.ts";

const organization = "VOICEVOX";
const githubApiBaseUrl = "https://api.github.com";
const cacheFormatVersion = 2;
const coreConcurrency = 8;
const searchIntervalMilliseconds = 2100;
const retryableStatuses = new Set([429, 502, 503, 504]);
const acceptedReviewStates = new Set([
  "APPROVED",
  "CHANGES_REQUESTED",
  "COMMENTED",
]);

const userSchema = z.object({
  login: z.string().min(1),
  avatar_url: z.string().url(),
  type: z.string().min(1),
});

const repositorySchema = z.object({
  full_name: z.string().min(3),
  private: z.boolean(),
  archived: z.boolean(),
  fork: z.boolean(),
  mirror_url: z.string().url().nullable(),
});

const labelSchema = z.object({
  name: z.string(),
});

const searchItemSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullable(),
  html_url: z.string().url(),
  repository_url: z.string().url(),
  user: userSchema.nullable(),
  state: z.enum(["open", "closed"]),
  state_reason: z.string().nullable(),
  created_at: z.string().datetime(),
  closed_at: z.string().datetime().nullable(),
  labels: z.array(labelSchema),
  pull_request: z
    .object({
      url: z.string().url(),
    })
    .optional(),
});

const searchSchema = z.object({
  total_count: z.number().int().nonnegative(),
  incomplete_results: z.boolean(),
  items: z.array(searchItemSchema),
});

const pullSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullable(),
  html_url: z.string().url(),
  user: userSchema.nullable(),
  merged_by: userSchema.nullable(),
  merged_at: z.string().datetime().nullable(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  changed_files: z.number().int().nonnegative(),
  labels: z.array(labelSchema),
});

const pullFileSchema = z.object({
  filename: z.string().min(1),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});

const pullReviewSchema = z.object({
  user: userSchema.nullable(),
  body: z.string().nullable(),
  state: z.string(),
  submitted_at: z.string().datetime().nullable(),
});

const reviewCommentSchema = z.object({
  user: userSchema.nullable(),
  body: z.string(),
  created_at: z.string().datetime(),
  in_reply_to_id: z.number().int().positive().nullable().optional(),
});

const pullCommitSchema = z.object({
  author: userSchema.nullable(),
  commit: z.object({
    message: z.string(),
  }),
});

const issueSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullable(),
  html_url: z.string().url(),
  user: userSchema.nullable(),
  state: z.enum(["open", "closed"]),
  state_reason: z.string().nullable(),
  created_at: z.string().datetime(),
  closed_at: z.string().datetime().nullable(),
  labels: z.array(labelSchema),
  pull_request: z
    .object({
      url: z.string().url(),
    })
    .optional(),
});

const issueCommentSchema = z.object({
  body: z.string(),
  user: userSchema.nullable(),
  created_at: z.string().datetime(),
});

const apiErrorSchema = z.object({
  message: z.string(),
});

const cacheEntrySchema = z.object({
  version: z.literal(cacheFormatVersion),
  url: z.string().url(),
  etag: z.string().min(1).optional(),
  lastModified: z.string().min(1).optional(),
  payload: z.unknown(),
});

const cliOptionsSchema = z
  .object({
    months: z.number().int().positive().max(12).optional(),
    start: z.iso.date().optional(),
    end: z.iso.date().optional(),
    output: z.string().min(1),
    cacheDirectory: z.string().min(1),
  })
  .superRefine((options, context) => {
    const hasStart = options.start != null;
    const hasEnd = options.end != null;
    if (hasStart !== hasEnd) {
      context.addIssue({
        code: "custom",
        message: "--start と --end は両方指定してください。",
      });
    }
    if (options.months != null && hasStart) {
      context.addIssue({
        code: "custom",
        message: "--months と日付範囲は同時に指定できません。",
      });
    }
    if (
      options.start != null &&
      options.end != null &&
      options.start > options.end
    ) {
      context.addIssue({
        code: "custom",
        message: "--end は --start 以降にしてください。",
      });
    }
  });

type GithubUser = z.infer<typeof userSchema>;
type GithubRepository = z.infer<typeof repositorySchema>;
type SearchResult = z.infer<typeof searchSchema>;
type GithubPull = z.infer<typeof pullSchema>;
type GithubPullFile = z.infer<typeof pullFileSchema>;
type GithubPullReview = z.infer<typeof pullReviewSchema>;
type GithubReviewComment = z.infer<typeof reviewCommentSchema>;
type GithubPullCommit = z.infer<typeof pullCommitSchema>;
type GithubIssue = z.infer<typeof issueSchema>;
type GithubIssueComment = z.infer<typeof issueCommentSchema>;
type CacheEntry = z.infer<typeof cacheEntrySchema>;

interface CliOptions {
  range: DateRange;
  output: string;
  cacheDirectory: string;
}

interface Target {
  repository: string;
  number: number;
  issue?: GithubIssue | undefined;
}

interface PullBundle {
  repository: string;
  pull: GithubPull;
  files: GithubPullFile[];
  reviews: GithubPullReview[];
  reviewComments: GithubReviewComment[];
  commits: GithubPullCommit[];
}

interface ResolvedIssue {
  key: string;
  repository: string;
  issue: GithubIssue;
}

interface RateState {
  remaining: number;
  resetsAt: number;
}

interface RequestStats {
  networkRequests: number;
  cacheRevalidations: number;
  notModifiedResponses: number;
}

class GitHubApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
  }
}

class Semaphore {
  private readonly limit: number;
  private activeCount = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(limit: number) {
    if (Number.isInteger(limit) === false || limit <= 0) {
      throw new Error("API 並列数は正の整数で指定してください。");
    }
    this.limit = limit;
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.activeCount < this.limit) {
      this.activeCount += 1;
      return;
    }
    await new Promise<void>((resolveWaiter) => {
      this.waiters.push(resolveWaiter);
    });
    this.activeCount += 1;
  }

  private release(): void {
    this.activeCount -= 1;
    const waiter = this.waiters.shift();
    if (waiter != null) {
      waiter();
    }
  }
}

class GitHubApiClient {
  private readonly token: string;
  private readonly cacheDirectory: string;
  private readonly semaphore = new Semaphore(coreConcurrency);
  private readonly searchSemaphore = new Semaphore(1);
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly rateStates = new Map<string, RateState>();
  private searchStartedAt = 0;
  private readonly stats: RequestStats = {
    networkRequests: 0,
    cacheRevalidations: 0,
    notModifiedResponses: 0,
  };

  constructor(token: string, cacheDirectory: string) {
    this.token = token;
    this.cacheDirectory = cacheDirectory;
  }

  /** REST API の応答をキャッシュ再検証付きで取得する。 */
  async request<T>(
    path: string,
    schema: z.ZodType<T>,
    resource: "core" | "search",
  ): Promise<T> {
    const url = githubApiBaseUrl + path;
    const current = this.inflight.get(url);
    if (current != null) {
      return schema.parse(await current);
    }
    const request = this.requestAndValidate(url, schema, resource);
    this.inflight.set(url, request);
    try {
      return schema.parse(await request);
    } finally {
      this.inflight.delete(url);
    }
  }

  /** ページングされた REST API を最後まで取得する。 */
  async paginate<T>(
    path: string,
    itemSchema: z.ZodType<T>,
    maxPages: number,
  ): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const separator = path.includes("?") ? "&" : "?";
      const pageItems = await this.request(
        path + separator + "per_page=100&page=" + page,
        z.array(itemSchema),
        "core",
      );
      items.push(...pageItems);
      if (pageItems.length < 100) {
        return items;
      }
    }
    throw new Error(
      "GitHub API のページ上限まで取得しました。データを完全に取得できません。",
    );
  }

  /** 取得回数と最後に確認した API 残量を返す。 */
  getAcquisitionStats(): LeaderboardDataset["acquisition"] {
    const core = this.rateStates.get("core");
    const search = this.rateStates.get("search");
    return {
      ...this.stats,
      ...(core == null ? {} : { remainingCoreRequests: core.remaining }),
      ...(search == null
        ? {}
        : { remainingSearchRequests: search.remaining }),
    };
  }

  private async requestAndValidate<T>(
    url: string,
    schema: z.ZodType<T>,
    resource: "core" | "search",
  ): Promise<T> {
    const cache = await this.readCache(url);
    const headers = this.createHeaders(cache);
    if (headers.has("If-None-Match") || headers.has("If-Modified-Since")) {
      this.stats.cacheRevalidations += 1;
    }

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      let response: Response;
      try {
        response = await this.semaphore.run(async () => {
          await this.waitForRateLimit(resource);
          const fetchOperation = async (): Promise<Response> => {
            if (resource === "search") {
              await this.waitForSearchInterval();
            }
            this.stats.networkRequests += 1;
            return fetch(url, { headers });
          };
          return resource === "search"
            ? this.searchSemaphore.run(fetchOperation)
            : fetchOperation();
        });
      } catch (error) {
        if (attempt < 3 && error instanceof TypeError) {
          await wait(attempt * 750);
          continue;
        }
        throw new Error("GitHub API との通信に失敗しました。", { cause: error });
      }

      this.updateRateLimit(response.headers, resource);
      if (response.status === 304) {
        if (cache == null) {
          throw new Error("キャッシュがない URL に 304 応答が返されました。");
        }
        this.stats.notModifiedResponses += 1;
        return schema.parse(cache.payload);
      }
      if (shouldRetry(response) && attempt < 3) {
        await wait(retryDelayMilliseconds(response.headers, attempt));
        continue;
      }

      const payload = await parseJsonResponse(response);
      if (response.ok === false) {
        const parsedError = apiErrorSchema.safeParse(payload);
        const detail = parsedError.success
          ? parsedError.data.message
          : response.statusText;
        throw new GitHubApiError(
          "GitHub API がエラーを返しました。HTTP " +
            response.status +
            " " +
            detail,
          response.status,
        );
      }
      const parsed = schema.parse(payload);
      await this.writeCache(url, response.headers, parsed);
      return parsed;
    }
    throw new Error("GitHub API のリトライ回数を超えました。");
  }

  private createHeaders(cache: CacheEntry | undefined): Headers {
    const headers = new Headers({
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + this.token,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "VOICEVOX-Contribution-Leaderboard",
    });
    if (cache?.etag != null) {
      headers.set("If-None-Match", cache.etag);
    } else if (cache?.lastModified != null) {
      headers.set("If-Modified-Since", cache.lastModified);
    }
    return headers;
  }

  private async readCache(url: string): Promise<CacheEntry | undefined> {
    const path = this.cachePath(url);
    if (existsSync(path) === false) {
      return undefined;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      throw new Error("GitHub API キャッシュを読み取れません。", {
        cause: error,
      });
    }
    const parsed = cacheEntrySchema.parse(raw);
    if (parsed.url !== url) {
      throw new Error("GitHub API キャッシュの URL が一致しません。");
    }
    return parsed;
  }

  private async writeCache<T>(
    url: string,
    headers: Headers,
    payload: T,
  ): Promise<void> {
    const etag = headers.get("etag");
    const lastModified = headers.get("last-modified");
    const entry: CacheEntry = {
      version: cacheFormatVersion,
      url,
      ...(etag == null ? {} : { etag }),
      ...(lastModified == null ? {} : { lastModified }),
      payload,
    };
    const path = this.cachePath(url);
    const temporaryPath = path + "." + process.pid + ".tmp";
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temporaryPath, JSON.stringify(entry), "utf8");
    await rename(temporaryPath, path);
  }

  private cachePath(url: string): string {
    const key = createHash("sha256")
      .update(cacheFormatVersion + "\n" + url)
      .digest("hex");
    return resolve(this.cacheDirectory, key + ".json");
  }

  private updateRateLimit(headers: Headers, resource: string): void {
    const remainingText = headers.get("x-ratelimit-remaining");
    const resetText = headers.get("x-ratelimit-reset");
    const responseResource = headers.get("x-ratelimit-resource") ?? resource;
    if (remainingText == null || resetText == null) {
      return;
    }
    const remaining = Number(remainingText);
    const resetsAt = Number(resetText) * 1000;
    if (
      Number.isFinite(remaining) === false ||
      Number.isFinite(resetsAt) === false
    ) {
      throw new Error("GitHub API のレート制限ヘッダーが数値ではありません。");
    }
    const current = this.rateStates.get(responseResource);
    if (current == null || resetsAt > current.resetsAt) {
      this.rateStates.set(responseResource, { remaining, resetsAt });
      return;
    }
    if (resetsAt === current.resetsAt && remaining < current.remaining) {
      this.rateStates.set(responseResource, { remaining, resetsAt });
    }
  }

  private async waitForRateLimit(resource: "core" | "search"): Promise<void> {
    const state = this.rateStates.get(resource);
    if (state == null) {
      return;
    }
    const reserve = resource === "core" ? 50 : 2;
    if (state.remaining > reserve || state.resetsAt <= Date.now()) {
      return;
    }
    const duration = state.resetsAt - Date.now() + 1000;
    console.warn(
      "GitHub " +
        resource +
        " API の残量を確保するため " +
        Math.ceil(duration / 1000) +
        " 秒待機します。",
    );
    await wait(duration);
    this.rateStates.delete(resource);
  }

  private async waitForSearchInterval(): Promise<void> {
    const duration =
      this.searchStartedAt + searchIntervalMilliseconds - Date.now();
    if (duration > 0) {
      await wait(duration);
    }
    this.searchStartedAt = Date.now();
  }
}

class DatasetBuilder {
  private readonly client: GitHubApiClient;
  private readonly repositoryKeys: Set<string>;
  private readonly pullRequests = new Map<string, Promise<GithubPull>>();
  private readonly issueRequests = new Map<string, Promise<GithubIssue>>();
  private readonly activityCandidateKeys = new Set<string>();
  private readonly includedIssueKeys = new Set<string>();

  constructor(client: GitHubApiClient, repositories: GithubRepository[]) {
    this.client = client;
    this.repositoryKeys = new Set(
      repositories.map((repository) => repository.full_name.toLowerCase()),
    );
  }

  /** Issue 検索結果を独立 Issue の候補として登録する。 */
  registerActivityCandidates(targets: Target[]): void {
    for (const target of targets) {
      const key = createKey(target.repository, target.number);
      this.activityCandidateKeys.add(key);
      this.includedIssueKeys.add(key);
    }
  }

  /** PR の採点に必要な REST API データを取得する。 */
  async fetchPullBundle(target: Target): Promise<PullBundle> {
    const pull = await this.getPull(target.repository, target.number);
    if (pull.changed_files > 3000) {
      throw new Error(
        createKey(target.repository, target.number) +
          " は変更ファイルが 3000 件を超えています。",
      );
    }
    const path = createRepositoryPath(target.repository) + "/pulls/" + target.number;
    const [files, reviews, reviewComments, commits] = await Promise.all([
      this.client.paginate(path + "/files", pullFileSchema, 31),
      this.client.paginate(path + "/reviews", pullReviewSchema, 30),
      this.client.paginate(path + "/comments", reviewCommentSchema, 30),
      this.client.paginate(path + "/commits", pullCommitSchema, 30),
    ]);
    if (files.length !== pull.changed_files) {
      throw new Error(
        createKey(target.repository, target.number) +
          " の変更ファイル数が GitHub API の集計値と一致しません。",
      );
    }
    return {
      repository: target.repository,
      pull,
      files,
      reviews,
      reviewComments,
      commits,
    };
  }

  /** PR 本文から主たる関連 Issue を解決する。 */
  async resolveIssue(bundle: PullBundle): Promise<ResolvedIssue | undefined> {
    const parts = parseRepository(bundle.repository);
    const body = bundle.pull.body ?? "";
    const direct = [
      ...extractClosingReferences(body, parts.owner, parts.repository),
      ...extractRelatedIssueReferences(body, parts.owner, parts.repository),
    ];
    const directIssue = await this.findFirstIssue(direct, false);
    if (directIssue != null) {
      return directIssue;
    }
    return this.findFirstIssue(
      extractGithubReferences(body, parts.owner, parts.repository),
      true,
    );
  }

  /** 検索候補の Issue 詳細を取得する。 */
  async fetchActivityCandidateIssues(targets: Target[]): Promise<void> {
    await mapWithConcurrency(targets, coreConcurrency, async (target) => {
      if (target.issue != null) {
        const key = createKey(target.repository, target.number);
        this.issueRequests.set(key, Promise.resolve(target.issue));
        return;
      }
      await this.getIssue(target.repository, target.number);
    });
  }

  /** 取得済み Issue を画面向けデータへ変換する。 */
  async prepareIssues(): Promise<PreparedIssue[]> {
    const entries = [...this.issueRequests.entries()]
      .filter(([key]) => this.includedIssueKeys.has(key))
      .sort(([left], [right]) => left.localeCompare(right));
    return mapWithConcurrency(entries, coreConcurrency, async ([key, request]) => {
      const issue = await request;
      const repository = repositoryFromGithubUrl(issue.html_url);
      const comments = await this.client.paginate(
        createRepositoryPath(repository) + "/issues/" + issue.number + "/comments",
        issueCommentSchema,
        100,
      );
      return prepareIssue(
        repository,
        issue,
        comments,
        this.activityCandidateKeys.has(key),
      );
    });
  }

  private async getPull(repository: string, number: number): Promise<GithubPull> {
    const key = createKey(repository, number);
    const cached = this.pullRequests.get(key);
    if (cached != null) {
      return cached;
    }
    const request = this.client.request(
      createRepositoryPath(repository) + "/pulls/" + number,
      pullSchema,
      "core",
    );
    this.pullRequests.set(key, request);
    return request;
  }

  private async getIssue(repository: string, number: number): Promise<GithubIssue> {
    const key = createKey(repository, number);
    const cached = this.issueRequests.get(key);
    if (cached != null) {
      return cached;
    }
    const request = this.client.request(
      createRepositoryPath(repository) + "/issues/" + number,
      issueSchema,
      "core",
    );
    this.issueRequests.set(key, request);
    return request;
  }

  private async findFirstIssue(
    references: GithubReference[],
    tracePull: boolean,
  ): Promise<ResolvedIssue | undefined> {
    for (const reference of references) {
      if (reference.owner.toLowerCase() !== organization.toLowerCase()) {
        continue;
      }
      const repository = reference.owner + "/" + reference.repository;
      if (this.repositoryKeys.has(repository.toLowerCase()) === false) {
        continue;
      }

      let issue: GithubIssue;
      try {
        issue = await this.getIssue(repository, reference.number);
      } catch (error) {
        if (error instanceof GitHubApiError && error.status === 404) {
          console.warn(
            createKey(repository, reference.number) +
              " は参照先が存在しないため関連判定から除外します。",
          );
          continue;
        }
        throw error;
      }
      if (issue.pull_request == null) {
        if (tracePull) {
          continue;
        }
        const key = createKey(repository, reference.number);
        this.includedIssueKeys.add(key);
        return {
          key,
          repository,
          issue,
        };
      }
      if (tracePull === false) {
        continue;
      }

      const pull = await this.getPull(repository, reference.number);
      const parts = parseRepository(repository);
      const pullBody = pull.body ?? "";
      const tracedIssue = await this.findFirstIssue(
        [
          ...extractClosingReferences(
            pullBody,
            parts.owner,
            parts.repository,
          ),
          ...extractRelatedIssueReferences(
            pullBody,
            parts.owner,
            parts.repository,
          ),
        ],
        false,
      );
      if (tracedIssue != null) {
        return tracedIssue;
      }
    }
    return undefined;
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (token == null || token.trim() === "") {
    throw new Error("GH_TOKEN または GITHUB_TOKEN を設定してください。");
  }

  const client = new GitHubApiClient(token.trim(), options.cacheDirectory);
  console.log("VOICEVOX の公開リポジトリを取得します。");
  const repositories = (await client.paginate(
    "/orgs/VOICEVOX/repos?type=public&sort=full_name",
    repositorySchema,
    10,
  ))
    .filter(
      (repository) =>
        repository.private === false && repository.archived === false,
    )
    .sort((left, right) => left.full_name.localeCompare(right.full_name));
  const repositoryKeys = new Set(
    repositories.map((repository) => repository.full_name.toLowerCase()),
  );
  console.log(repositories.length + " 件を対象にします。fork と mirror を含みます。");

  const [pullTargets, issueTargets] = await Promise.all([
    searchTargets(client, "pull", options.range, repositoryKeys),
    searchTargets(client, "issue", options.range, repositoryKeys),
  ]);
  console.log(
    "マージ済み PR " +
      pullTargets.length +
      " 件、活動 Issue " +
      issueTargets.length +
      " 件を取得します。",
  );

  const builder = new DatasetBuilder(client, repositories);
  builder.registerActivityCandidates(issueTargets);
  await builder.fetchActivityCandidateIssues(issueTargets);
  let completedPulls = 0;
  const bundles = await mapWithConcurrency(
    pullTargets,
    coreConcurrency,
    async (target) => {
      const bundle = await builder.fetchPullBundle(target);
      completedPulls += 1;
      if (completedPulls % 10 === 0 || completedPulls === pullTargets.length) {
        console.log(
          "PR データを " + completedPulls + "/" + pullTargets.length + " 件取得しました。",
        );
      }
      return bundle;
    },
  );
  const resolvedIssues = await mapWithConcurrency(
    bundles,
    coreConcurrency,
    async (bundle) => builder.resolveIssue(bundle),
  );
  const pulls = bundles
    .map((bundle, index) => {
      const resolvedIssue = resolvedIssues[index];
      return preparePull(bundle, resolvedIssue);
    })
    .sort((left, right) => left.key.localeCompare(right.key));
  const issues = (await builder.prepareIssues()).sort((left, right) =>
    left.key.localeCompare(right.key),
  );

  const dataset: LeaderboardDataset = {
    schemaVersion: 2,
    organization,
    generatedAt: new Date().toISOString(),
    range: options.range,
    repositories: repositories.map((repository) => ({
      nameWithOwner: repository.full_name,
      fork: repository.fork,
      mirror: repository.mirror_url != null,
    })),
    pulls,
    issues,
    notices: [
      "対象は VOICEVOX Organization の公開かつ非アーカイブな全リポジトリです。fork と mirror も含みます。",
      "Issue の作成、Close、コメントは選択期間内のイベントだけを配点します。",
      "古い Issue の本文編集日時は特定できないため、本文の証拠要素は Issue 作成日が選択期間内の場合だけ数えます。",
      "複数 PR の Conventional Commits 補正は、PR 分割による加点を防ぐため最大値を一度だけ使います。",
      "共同作者は GitHub が関連付けたコミット作者と GitHub noreply 形式の Co-authored-by から解決します。",
    ],
    acquisition: client.getAcquisitionStats(),
  };
  const validated = leaderboardDatasetSchema.parse(dataset);
  await writeDataset(options.output, validated);
  console.log(
    "事前取得データを書き出しました。" +
      " PR " +
      pulls.length +
      " 件、Issue " +
      issues.length +
      " 件、API 通信 " +
      validated.acquisition.networkRequests +
      " 回、304 応答 " +
      validated.acquisition.notModifiedResponses +
      " 回。",
  );
}

async function searchTargets(
  client: GitHubApiClient,
  kind: "pull" | "issue",
  range: DateRange,
  repositoryKeys: Set<string>,
): Promise<Target[]> {
  const items = await searchRange(client, kind, range);
  const targets = new Map<string, Target>();
  for (const item of items) {
    const repository = repositoryFromApiUrl(item.repository_url);
    if (repositoryKeys.has(repository.toLowerCase()) === false) {
      continue;
    }
    const target: Target = {
      repository,
      number: item.number,
      ...(kind === "issue" ? { issue: item } : {}),
    };
    targets.set(createKey(repository, item.number), target);
  }
  return [...targets.values()].sort(
    (left, right) =>
      left.repository.localeCompare(right.repository) ||
      left.number - right.number,
  );
}

async function searchRange(
  client: GitHubApiClient,
  kind: "pull" | "issue",
  range: DateRange,
): Promise<SearchResult["items"]> {
  const query = createSearchQuery(kind, range);
  const firstPage = await searchPage(client, query, 1);
  if (firstPage.incomplete_results) {
    throw new Error("GitHub Search API が不完全な検索結果を返しました。");
  }
  if (firstPage.total_count > 1000) {
    const split = splitDateRange(range);
    if (split == null) {
      throw new Error(
        range.start + " の GitHub 検索結果が上限 1000 件を超えました。",
      );
    }
    const [left, right] = await Promise.all([
      searchRange(client, kind, split.left),
      searchRange(client, kind, split.right),
    ]);
    return [...left, ...right];
  }

  const pageCount = Math.ceil(firstPage.total_count / 100);
  const items = [...firstPage.items];
  for (let page = 2; page <= pageCount; page += 1) {
    const result = await searchPage(client, query, page);
    if (result.incomplete_results) {
      throw new Error("GitHub Search API が不完全な検索結果を返しました。");
    }
    if (result.total_count !== firstPage.total_count) {
      throw new Error("ページ取得中に GitHub 検索結果の件数が変わりました。");
    }
    items.push(...result.items);
  }
  if (items.length !== firstPage.total_count) {
    throw new Error("GitHub 検索結果を最後まで取得できませんでした。");
  }
  return items;
}

async function searchPage(
  client: GitHubApiClient,
  query: string,
  page: number,
): Promise<SearchResult> {
  return client.request(
    "/search/issues?q=" +
      encodeURIComponent(query) +
      "&sort=updated&order=asc&per_page=100&page=" +
      page,
    searchSchema,
    "search",
  );
}

function createSearchQuery(kind: "pull" | "issue", range: DateRange): string {
  if (kind === "pull") {
    return (
      "org:VOICEVOX is:pr is:merged merged:" + range.start + ".." + range.end
    );
  }
  return "org:VOICEVOX is:issue updated:" + range.start + ".." + range.end;
}

function preparePull(
  bundle: PullBundle,
  resolvedIssue: ResolvedIssue | undefined,
): PreparedPull {
  const mergedAt = bundle.pull.merged_at;
  assertNonNullable(
    mergedAt,
    createKey(bundle.repository, bundle.pull.number) +
      " はマージ済みですが merged_at がありません。",
  );
  const author = bundle.pull.user;
  assertNonNullable(
    author,
    createKey(bundle.repository, bundle.pull.number) +
      " の作者を取得できません。",
  );
  const mergedBy = bundle.pull.merged_by;
  assertNonNullable(
    mergedBy,
    createKey(bundle.repository, bundle.pull.number) +
      " はマージ済みですがマージ者を取得できません。",
  );
  const files = bundle.files.map(calculateFileScore);
  const effectiveLines = sum(files.map((file) => file.effectiveLines));
  const nonGeneratedFiles = files.filter((file) => file.generated === false).length;
  const body = bundle.pull.body ?? "";
  return {
    key: createKey(bundle.repository, bundle.pull.number),
    repository: bundle.repository,
    number: bundle.pull.number,
    title: bundle.pull.title,
    githubUrl: bundle.pull.html_url,
    mergedAt,
    author: toActor(author),
    authorIsHuman: isHumanUser(author),
    mergedBy: toActor(mergedBy),
    mergedByIsHuman: isHumanUser(mergedBy),
    coauthors: extractCoauthors(bundle.commits, author.login),
    files,
    effectiveLines,
    nonGeneratedFiles,
    mass: calculatePullMass(effectiveLines, nonGeneratedFiles),
    conventionalBonus: calculateConventionalBonus(
      bundle.pull.title,
      body,
      bundle.pull.labels.map((label) => label.name),
    ),
    reviews: bundle.reviews
      .filter(
        (review) =>
          review.user != null &&
          isHumanUser(review.user) &&
          review.user.login.toLowerCase() !== author.login.toLowerCase() &&
          review.submitted_at != null &&
          acceptedReviewStates.has(review.state.toUpperCase()),
      )
      .map((review) => {
        const user = review.user;
        const submittedAt = review.submitted_at;
        assertNonNullable(user, "検証済みレビューに作者がありません。");
        assertNonNullable(submittedAt, "検証済みレビューに日時がありません。");
        return {
          actor: toActor(user),
          submittedAt,
          state: parsePreparedReviewState(review.state),
          hasSubstantiveSummary:
            review.body != null && isSubstantiveReviewText(review.body),
        };
      })
      .sort((left, right) => left.submittedAt.localeCompare(right.submittedAt)),
    reviewThreads: bundle.reviewComments
      .filter(
        (comment) =>
          comment.user != null &&
          isHumanUser(comment.user) &&
          comment.user.login.toLowerCase() !== author.login.toLowerCase() &&
          comment.in_reply_to_id == null &&
          isSubstantiveReviewText(comment.body),
      )
      .map((comment) => {
        const user = comment.user;
        assertNonNullable(user, "検証済みレビューコメントに作者がありません。");
        return {
          actor: toActor(user),
          createdAt: comment.created_at,
        };
      })
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    ...(resolvedIssue == null ? {} : { issueKey: resolvedIssue.key }),
  };
}

function parsePreparedReviewState(state: string): PreparedReviewState {
  switch (state.toUpperCase()) {
    case "APPROVED":
      return "APPROVED";
    case "CHANGES_REQUESTED":
      return "CHANGES_REQUESTED";
    case "COMMENTED":
      return "COMMENTED";
    default:
      throw new Error("採点対象外のレビュー状態です: " + state);
  }
}

function prepareIssue(
  repository: string,
  issue: GithubIssue,
  comments: GithubIssueComment[],
  activityCandidate: boolean,
): PreparedIssue {
  const author = issue.user;
  return {
    key: createKey(repository, issue.number),
    repository,
    number: issue.number,
    title: issue.title,
    githubUrl: issue.html_url,
    ...(author == null ? {} : { author: toActor(author) }),
    authorIsHuman: author != null && isHumanUser(author),
    state: issue.state,
    ...(issue.state_reason == null ? {} : { stateReason: issue.state_reason }),
    createdAt: issue.created_at,
    ...(issue.closed_at == null ? {} : { closedAt: issue.closed_at }),
    labels: issue.labels.map((label) => label.name),
    bodyEvidenceKinds: detectEvidenceKinds(issue.body ?? ""),
    comments: comments
      .map((comment) => {
        const actor =
          comment.user != null && isHumanUser(comment.user)
            ? toActor(comment.user)
            : undefined;
        return {
          ...(actor == null ? {} : { actor }),
          createdAt: comment.created_at,
          substantive:
            actor != null && isSubstantiveIssueText(comment.body),
          evidenceKinds: detectEvidenceKinds(comment.body),
        };
      })
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    activityCandidate,
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

function toActor(user: GithubUser): Actor {
  return {
    login: user.login,
    avatarUrl: user.avatar_url,
  };
}

function actorFromLogin(login: string): Actor {
  return {
    login,
    avatarUrl: "https://github.com/" + login + ".png?size=96",
  };
}

function isHumanUser(user: GithubUser): boolean {
  return user.type === "User" && isBotLogin(user.login) === false;
}

function isBotLogin(login: string): boolean {
  return /\[bot\]$|(?:^|[-_])bot$/i.test(login);
}

function parseCliOptions(arguments_: string[]): CliOptions {
  const normalizedArguments =
    arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  const values: {
    months?: number;
    start?: string;
    end?: string;
    output: string;
    cacheDirectory: string;
  } = {
    output: "public/data/leaderboard-data.json",
    cacheDirectory: ".cache/github",
  };
  for (let index = 0; index < normalizedArguments.length; index += 2) {
    const flag = normalizedArguments[index];
    const value = normalizedArguments[index + 1];
    assertNonNullable(flag, "コマンドライン引数の名前がありません。");
    assertNonNullable(value, flag + " の値がありません。");
    switch (flag) {
      case "--months":
        values.months = Number(value);
        break;
      case "--start":
        values.start = value;
        break;
      case "--end":
        values.end = value;
        break;
      case "--output":
        values.output = value;
        break;
      case "--cache":
        values.cacheDirectory = value;
        break;
      default:
        throw new Error("未対応の引数です: " + flag);
    }
  }
  const parsed = cliOptionsSchema.parse(values);
  const end = parsed.end ?? currentUtcDate();
  const start = parsed.start ?? subtractCalendarMonths(end, parsed.months ?? 3);
  return {
    range: { start, end },
    output: resolve(parsed.output),
    cacheDirectory: resolve(parsed.cacheDirectory),
  };
}

function subtractCalendarMonths(dateText: string, months: number): string {
  const date = parseDate(dateText);
  const targetMonth = date.getUTCMonth() - months;
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), targetMonth + 1, 0),
  ).getUTCDate();
  return formatDate(
    new Date(
      Date.UTC(
        date.getUTCFullYear(),
        targetMonth,
        Math.min(date.getUTCDate(), lastDay),
      ),
    ),
  );
}

function splitDateRange(
  range: DateRange,
): { left: DateRange; right: DateRange } | undefined {
  const start = parseDate(range.start);
  const end = parseDate(range.end);
  const dayCount = Math.round((end.getTime() - start.getTime()) / 86400000);
  if (dayCount <= 0) {
    return undefined;
  }
  const leftEnd = new Date(start.getTime() + Math.floor(dayCount / 2) * 86400000);
  const rightStart = new Date(leftEnd.getTime() + 86400000);
  return {
    left: { start: range.start, end: formatDate(leftEnd) },
    right: { start: formatDate(rightStart), end: range.end },
  };
}

function currentUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseDate(value: string): Date {
  const date = new Date(value + "T00:00:00Z");
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error("実在する日付を指定してください: " + value);
  }
  return date;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseRepository(fullName: string): {
  owner: string;
  repository: string;
} {
  const separator = fullName.indexOf("/");
  if (separator <= 0 || separator === fullName.length - 1) {
    throw new Error("リポジトリ名は owner/name 形式で指定してください。");
  }
  return {
    owner: fullName.slice(0, separator),
    repository: fullName.slice(separator + 1),
  };
}

function createRepositoryPath(repository: string): string {
  const parts = parseRepository(repository);
  return (
    "/repos/" +
    encodeURIComponent(parts.owner) +
    "/" +
    encodeURIComponent(parts.repository)
  );
}

function repositoryFromApiUrl(value: string): string {
  const url = new URL(value);
  const match = /^\/repos\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  const owner = match?.[1];
  const repository = match?.[2];
  assertNonNullable(owner, "GitHub API URL から owner を取得できません。");
  assertNonNullable(
    repository,
    "GitHub API URL からリポジトリ名を取得できません。",
  );
  return decodeURIComponent(owner) + "/" + decodeURIComponent(repository);
}

function repositoryFromGithubUrl(value: string): string {
  const url = new URL(value);
  const parts = url.pathname.split("/").filter((part) => part !== "");
  const owner = parts[0];
  const repository = parts[1];
  assertNonNullable(owner, "GitHub URL から owner を取得できません。");
  assertNonNullable(
    repository,
    "GitHub URL からリポジトリ名を取得できません。",
  );
  return decodeURIComponent(owner) + "/" + decodeURIComponent(repository);
}

function createKey(repository: string, number: number): string {
  return repository.toLowerCase() + "#" + number;
}

function shouldRetry(response: Response): boolean {
  return (
    retryableStatuses.has(response.status) ||
    (response.status === 403 &&
      (response.headers.has("retry-after") ||
        response.headers.get("x-ratelimit-remaining") === "0"))
  );
}

function retryDelayMilliseconds(headers: Headers, attempt: number): number {
  const retryAfter = headers.get("retry-after");
  if (retryAfter != null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) === false) {
      throw new Error("Retry-After ヘッダーが数値ではありません。");
    }
    return Math.min(60000, seconds * 1000);
  }
  const resetText = headers.get("x-ratelimit-reset");
  if (resetText == null) {
    return attempt * 1000;
  }
  const resetSeconds = Number(resetText);
  if (Number.isFinite(resetSeconds) === false) {
    throw new Error("GitHub API のリセット時刻が数値ではありません。");
  }
  return Math.max(1000, resetSeconds * 1000 - Date.now() + 1000);
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new Error("GitHub API の応答を JSON として解釈できません。", {
      cause: error,
    });
  }
}

async function writeDataset(
  output: string,
  dataset: LeaderboardDataset,
): Promise<void> {
  const temporaryOutput = output + "." + process.pid + ".tmp";
  await mkdir(dirname(output), { recursive: true });
  await writeFile(temporaryOutput, JSON.stringify(dataset) + "\n", "utf8");
  await rename(temporaryOutput, output);
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  if (Number.isInteger(concurrency) === false || concurrency <= 0) {
    throw new Error("並列数は正の整数で指定してください。");
  }
  let nextIndex = 0;
  const results: Array<{ index: number; value: R }> = [];
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        const value = values[index];
        assertNonNullable(value, "並列処理の対象がありません。");
        results.push({ index, value: await operation(value) });
      }
    },
  );
  await Promise.all(workers);
  return results
    .sort((left, right) => left.index - right.index)
    .map((result) => result.value);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

async function wait(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) {
    return;
  }
  await new Promise<void>((resolveWait) => {
    setTimeout(resolveWait, milliseconds);
  });
}

await main();
