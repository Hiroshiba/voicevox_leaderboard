import { z } from "zod";
import {
  GitHubApiError,
  GitHubNetworkError,
  GitHubResponseValidationError,
  assertNonNullable,
} from "../domain/errors";
import type { DateRange, RateLimit } from "../domain/model";
import {
  apiErrorSchema,
  issueCommentSchema,
  issueSchema,
  pullCommitSchema,
  pullFileSchema,
  pullReviewSchema,
  pullSchema,
  repositorySchema,
  reviewCommentSchema,
  searchIssuesSchema,
  type GithubIssue,
  type GithubIssueComment,
  type GithubPull,
  type GithubPullCommit,
  type GithubPullFile,
  type GithubPullReview,
  type GithubRepository,
  type GithubReviewComment,
} from "./githubSchemas";

const githubApiBaseUrl = "https://api.github.com";
const retryableStatuses = new Set([429, 502, 503, 504]);

interface RepositoryParts {
  owner: string;
  repository: string;
}

/** GitHub REST API を呼び出して応答を検証する。 */
export class GitHubClient {
  private readonly token: string;
  private requests = 0;
  private latestRateLimit: RateLimit | undefined;

  constructor(token: string) {
    this.token = token;
  }

  /** 現在までの API リクエスト数を返す。 */
  getRequestCount(): number {
    return this.requests;
  }

  /** 最後に確認した API レート制限を返す。 */
  getRateLimit(): RateLimit | undefined {
    return this.latestRateLimit;
  }

  /** Organization のリポジトリ一覧を返す。 */
  async listOrganizationRepositories(
    organization: string,
  ): Promise<GithubRepository[]> {
    return this.paginate(
      "/orgs/" +
        encodeURIComponent(organization) +
        "/repos?type=all&sort=full_name",
      repositorySchema,
      10,
    );
  }

  /** 指定期間にマージされた PR 番号を検索する。 */
  async searchMergedPullNumbers(
    repository: string,
    range: DateRange,
  ): Promise<number[]> {
    return this.searchIssueNumbers(
      "repo:" +
        repository +
        " is:pr is:merged merged:" +
        range.start +
        ".." +
        range.end,
    );
  }

  /** 指定期間に活動した可能性がある Issue 番号を検索する。 */
  async searchIssueActivityNumbers(
    repository: string,
    range: DateRange,
  ): Promise<number[]> {
    const numbers = new Set<number>();
    for (const qualifier of ["updated", "created", "closed"]) {
      const found = await this.searchIssueNumbers(
        "repo:" +
          repository +
          " is:issue " +
          qualifier +
          ":" +
          range.start +
          ".." +
          range.end,
      );
      for (const number of found) {
        numbers.add(number);
      }
    }
    return [...numbers].sort((left, right) => left - right);
  }

  /** PR の詳細を返す。 */
  async getPull(repository: string, number: number): Promise<GithubPull> {
    const parts = parseRepository(repository);
    return this.request(
      "/repos/" +
        encodeURIComponent(parts.owner) +
        "/" +
        encodeURIComponent(parts.repository) +
        "/pulls/" +
        number,
      pullSchema,
    );
  }

  /** PR の変更ファイルをすべて返す。 */
  async getPullFiles(
    repository: string,
    number: number,
    expectedCount: number,
  ): Promise<GithubPullFile[]> {
    if (expectedCount > 3000) {
      throw new Error(
        repository +
          "#" +
          number +
          " は変更ファイルが 3000 件を超えるため GitHub API で完全に取得できません。",
      );
    }
    const parts = parseRepository(repository);
    const files = await this.paginate(
      "/repos/" +
        encodeURIComponent(parts.owner) +
        "/" +
        encodeURIComponent(parts.repository) +
        "/pulls/" +
        number +
        "/files",
      pullFileSchema,
      31,
    );
    if (files.length !== expectedCount) {
      throw new Error(
        repository +
          "#" +
          number +
          " の変更ファイル数が GitHub API の集計値と一致しません。",
      );
    }
    return files;
  }

  /** PR のレビューをすべて返す。 */
  async getPullReviews(
    repository: string,
    number: number,
  ): Promise<GithubPullReview[]> {
    return this.getPullCollection(repository, number, "reviews", pullReviewSchema);
  }

  /** PR のインラインレビューコメントをすべて返す。 */
  async getReviewComments(
    repository: string,
    number: number,
  ): Promise<GithubReviewComment[]> {
    return this.getPullCollection(
      repository,
      number,
      "comments",
      reviewCommentSchema,
    );
  }

  /** PR に含まれるコミットを返す。 */
  async getPullCommits(
    repository: string,
    number: number,
  ): Promise<GithubPullCommit[]> {
    return this.getPullCollection(repository, number, "commits", pullCommitSchema);
  }

  /** Issue または PR の Issue 表現を返す。 */
  async getIssue(repository: string, number: number): Promise<GithubIssue> {
    const parts = parseRepository(repository);
    return this.request(
      "/repos/" +
        encodeURIComponent(parts.owner) +
        "/" +
        encodeURIComponent(parts.repository) +
        "/issues/" +
        number,
      issueSchema,
    );
  }

  /** Issue のコメントをすべて返す。 */
  async getIssueComments(
    repository: string,
    number: number,
  ): Promise<GithubIssueComment[]> {
    const parts = parseRepository(repository);
    return this.paginate(
      "/repos/" +
        encodeURIComponent(parts.owner) +
        "/" +
        encodeURIComponent(parts.repository) +
        "/issues/" +
        number +
        "/comments",
      issueCommentSchema,
      30,
    );
  }

  private async getPullCollection<T>(
    repository: string,
    number: number,
    collection: string,
    schema: z.ZodType<T>,
  ): Promise<T[]> {
    const parts = parseRepository(repository);
    return this.paginate(
      "/repos/" +
        encodeURIComponent(parts.owner) +
        "/" +
        encodeURIComponent(parts.repository) +
        "/pulls/" +
        number +
        "/" +
        collection,
      schema,
      30,
    );
  }

  private async searchIssueNumbers(query: string): Promise<number[]> {
    const numbers: number[] = [];
    let page = 1;
    while (page <= 10) {
      const result = await this.request(
        "/search/issues?q=" +
          encodeURIComponent(query) +
          "&sort=updated&order=asc&per_page=100&page=" +
          page,
        searchIssuesSchema,
      );
      if (result.incomplete_results) {
        throw new Error(
          "GitHub の検索結果が不完全です。しばらく待つか対象範囲を狭めてください。",
        );
      }
      if (result.total_count > 1000) {
        throw new Error(
          "1 リポジトリの検索結果が GitHub の上限 1000 件を超えました。期間を狭めてください。",
        );
      }
      numbers.push(...result.items.map((item) => item.number));
      if (
        result.items.length < 100 ||
        numbers.length === result.total_count
      ) {
        return numbers;
      }
      page += 1;
    }
    throw new Error("GitHub の検索結果を最後まで取得できませんでした。");
  }

  private async paginate<T>(
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
      );
      items.push(...pageItems);
      if (pageItems.length < 100) {
        return items;
      }
    }
    throw new Error(
      "GitHub API のページ上限まで取得しました。対象データを完全に取得できません。",
    );
  }

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(githubApiBaseUrl + path, {
          headers: this.createHeaders(),
        });
      } catch (error) {
        if (attempt < 3 && error instanceof TypeError) {
          await wait(attempt * 500);
          continue;
        }
        throw new GitHubNetworkError(
          "GitHub API との通信に失敗しました。",
          error,
        );
      }

      this.requests += 1;
      this.updateRateLimit(response.headers);
      if (shouldRetry(response) && attempt < 3) {
        await wait(retryDelayMilliseconds(response.headers, attempt));
        continue;
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw new GitHubResponseValidationError(
          "GitHub API の応答を JSON として解釈できません。",
          error,
        );
      }

      if (!response.ok) {
        const parsedError = apiErrorSchema.safeParse(payload);
        const detail = parsedError.success
          ? parsedError.data.message
          : response.statusText;
        throw new GitHubApiError(
          "GitHub API がエラーを返しました。" +
            " HTTP " +
            response.status +
            " " +
            detail,
          response.status,
        );
      }

      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        throw new GitHubResponseValidationError(
          "GitHub API の応答形式が想定と異なります。",
          parsed.error,
        );
      }
      return parsed.data;
    }
    throw new Error("GitHub API のリトライ回数を超えました。");
  }

  private createHeaders(): Headers {
    const headers = new Headers({
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    });
    if (this.token !== "") {
      headers.set("Authorization", "Bearer " + this.token);
    }
    return headers;
  }

  private updateRateLimit(headers: Headers): void {
    const limitText = headers.get("x-ratelimit-limit");
    const remainingText = headers.get("x-ratelimit-remaining");
    const resetText = headers.get("x-ratelimit-reset");
    if (limitText == null || remainingText == null || resetText == null) {
      return;
    }

    const limit = Number(limitText);
    const remaining = Number(remainingText);
    const resetSeconds = Number(resetText);
    if (
      Number.isFinite(limit) === false ||
      Number.isFinite(remaining) === false ||
      Number.isFinite(resetSeconds) === false
    ) {
      throw new Error("GitHub API のレート制限ヘッダーが数値ではありません。");
    }

    this.latestRateLimit = {
      limit,
      remaining,
      resetsAt: new Date(resetSeconds * 1000).toISOString(),
    };
  }
}

function parseRepository(fullName: string): RepositoryParts {
  const parts = fullName.split("/");
  if (parts.length !== 2) {
    throw new Error("リポジトリ名は owner/name 形式で指定してください。");
  }
  const owner = parts[0];
  const repository = parts[1];
  assertNonNullable(owner, "リポジトリの owner がありません。");
  assertNonNullable(repository, "リポジトリ名がありません。");
  if (owner === "" || repository === "") {
    throw new Error("リポジトリ名は owner/name 形式で指定してください。");
  }
  return { owner, repository };
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
    return attempt * 750;
  }
  const resetSeconds = Number(resetText);
  if (Number.isFinite(resetSeconds) === false) {
    throw new Error("GitHub API のリセット時刻が数値ではありません。");
  }
  return Math.min(
    60000,
    Math.max(1000, resetSeconds * 1000 - Date.now() + 1000),
  );
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}
