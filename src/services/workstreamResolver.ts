import {
  extractClosingReferences,
  extractGithubReferences,
  extractRelatedIssueReferences,
  type GithubReference,
} from "../domain/references";
import type {
  GithubIssue,
  GithubIssueComment,
  GithubPull,
} from "./githubSchemas";
import { GitHubClient } from "./githubClient";

export interface ResolvedIssue {
  key: string;
  repository: string;
  issue: GithubIssue;
}

export interface PullReferenceContext {
  repository: string;
  pull: GithubPull;
}

/** PR 本文からワークストリームの主 Issue を決定する。 */
export class WorkstreamResolver {
  private readonly client: GitHubClient;
  private readonly organization: string;
  private readonly issueCache = new Map<string, Promise<GithubIssue>>();
  private readonly pullCache = new Map<string, Promise<GithubPull>>();

  constructor(client: GitHubClient, organization: string) {
    this.client = client;
    this.organization = organization;
  }

  /** PR の主 Issue を優先規則に従って返す。 */
  async resolve(context: PullReferenceContext): Promise<ResolvedIssue | undefined> {
    const parts = parseFullName(context.repository);
    const body = context.pull.body ?? "";
    const direct = [
      ...extractClosingReferences(body, parts.owner, parts.repository),
      ...extractRelatedIssueReferences(body, parts.owner, parts.repository),
    ];

    const directIssue = await this.findFirstIssue(direct, false);
    if (directIssue != null) {
      return directIssue;
    }

    const relatedReferences = extractGithubReferences(
      body,
      parts.owner,
      parts.repository,
    );
    return this.findFirstIssue(relatedReferences, true);
  }

  /** キャッシュを利用して Issue を取得する。 */
  async getIssue(repository: string, number: number): Promise<GithubIssue> {
    const key = repository.toLowerCase() + "#" + number;
    const cached = this.issueCache.get(key);
    if (cached != null) {
      return cached;
    }
    const request = this.client.getIssue(repository, number);
    this.issueCache.set(key, request);
    return request;
  }

  /** Issue のコメントを取得する。 */
  async getIssueComments(
    repository: string,
    number: number,
  ): Promise<GithubIssueComment[]> {
    return this.client.getIssueComments(repository, number);
  }

  private async findFirstIssue(
    references: GithubReference[],
    tracePull: boolean,
  ): Promise<ResolvedIssue | undefined> {
    for (const reference of references) {
      if (
        reference.owner.toLowerCase() !== this.organization.toLowerCase()
      ) {
        continue;
      }
      const repository = reference.owner + "/" + reference.repository;
      const issue = await this.getIssue(repository, reference.number);
      if (issue.pull_request == null) {
        if (tracePull) {
          continue;
        }
        return {
          key: repository.toLowerCase() + "#" + reference.number,
          repository,
          issue,
        };
      }
      if (tracePull === false) {
        continue;
      }

      const pull = await this.getPull(repository, reference.number);
      const parts = parseFullName(repository);
      const pullBody = pull.body ?? "";
      const pullReferences = [
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
      ];
      const tracedIssue = await this.findFirstIssue(pullReferences, false);
      if (tracedIssue != null) {
        return tracedIssue;
      }
    }
    return undefined;
  }

  private async getPull(repository: string, number: number): Promise<GithubPull> {
    const key = repository.toLowerCase() + "#" + number;
    const cached = this.pullCache.get(key);
    if (cached != null) {
      return cached;
    }
    const request = this.client.getPull(repository, number);
    this.pullCache.set(key, request);
    return request;
  }
}

function parseFullName(fullName: string): {
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
