/// <reference types="node" />

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DatasetBuilder,
  GitHubApiClient,
  preparePull,
} from "../scripts/fetchGithubData.ts";

type PullBundle = Parameters<typeof preparePull>[0];

const alice = {
  login: "alice",
  avatar_url: "https://github.com/alice.png",
  type: "User",
};
const bob = {
  login: "bob",
  avatar_url: "https://github.com/bob.png",
  type: "User",
};
const cacheDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    cacheDirectories.map((cacheDirectory) =>
      rm(cacheDirectory, { recursive: true, force: true }),
    ),
  );
  cacheDirectories.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DatasetBuilder.fetchPullBundle", () => {
  it("変更ファイル数の不一致時にキャッシュを使わず再取得する", async () => {
    const scenario = await createFetchScenario(101);
    const log = vi
      .spyOn(globalThis.console, "log")
      .mockImplementation(() => undefined);

    const bundle = await scenario.builder.fetchPullBundle({
      repository: "voicevox/voicevox_vvm",
      number: 56,
    });

    expect(bundle.pull.changed_files).toBe(101);
    expect(bundle.files).toHaveLength(101);
    expect(scenario.pullRequestHeaders).toHaveLength(2);
    expect(scenario.fileRequestHeaders).toHaveLength(4);
    expect(
      scenario.pullRequestHeaders[1]?.get("If-None-Match"),
    ).toBeNull();
    expect(
      scenario.pullRequestHeaders[1]?.get("If-Modified-Since"),
    ).toBeNull();
    expect(
      scenario.fileRequestHeaders
        .slice(2)
        .map((headers) => headers.get("If-None-Match")),
    ).toEqual([null, null]);
    expect(
      scenario.fileRequestHeaders
        .slice(2)
        .map((headers) => headers.get("If-Modified-Since")),
    ).toEqual([null, null]);
    expect(log).toHaveBeenCalledWith(
      "voicevox/voicevox_vvm#56 の変更ファイル数が一致しないため、キャッシュを使わずに PR 詳細とファイル一覧を再取得します。",
    );
  });

  it("再取得しても変更ファイル数が一致しなければ例外を投げる", async () => {
    const scenario = await createFetchScenario(102);
    vi.spyOn(globalThis.console, "log").mockImplementation(() => undefined);

    await expect(
      scenario.builder.fetchPullBundle({
        repository: "voicevox/voicevox_vvm",
        number: 56,
      }),
    ).rejects.toThrow(
      "voicevox/voicevox_vvm#56 の変更ファイル数が GitHub API の集計値と一致しません。集計値は 102 件、ファイル一覧は 101 件です。",
    );
    expect(scenario.pullRequestHeaders).toHaveLength(2);
    expect(scenario.fileRequestHeaders).toHaveLength(4);
  });
});

describe("preparePull", () => {
  it("マージ済み PR の outcome を組み立てる", () => {
    const prepared = preparePull(createBundle({}), undefined, false);

    expect(prepared).toMatchObject({
      createdAt: "2026-07-01T00:00:00Z",
      outcome: {
        kind: "merged",
        mergedAt: "2026-07-10T00:00:00Z",
        mergedBy: {
          login: "bob",
          avatarUrl: "https://github.com/bob.png",
        },
        mergedByIsHuman: true,
      },
    });
  });

  it("オープン PR の outcome を組み立てる", () => {
    const prepared = preparePull(
      createBundle({
        merged_at: null,
        merged_by: null,
        state: "open",
        closed_at: null,
      }),
      undefined,
      false,
    );

    expect(prepared.outcome).toEqual({ kind: "open" });
  });

  it("クローズ済み未マージ PR の outcome を組み立てる", () => {
    const prepared = preparePull(
      createBundle({
        merged_at: null,
        merged_by: null,
        state: "closed",
        closed_at: "2026-07-09T00:00:00Z",
      }),
      undefined,
      false,
    );

    expect(prepared.outcome).toEqual({
      kind: "closed",
      closedAt: "2026-07-09T00:00:00Z",
    });
  });

  it("マージ済み PR にマージ者がなければ例外を投げる", () => {
    expect(() =>
      preparePull(createBundle({ merged_by: null }), undefined, false),
    ).toThrow("マージ者を取得できません");
  });

  it("クローズ済み未マージ PR に日時がなければ例外を投げる", () => {
    expect(() =>
      preparePull(
        createBundle({
          merged_at: null,
          merged_by: null,
          state: "closed",
          closed_at: null,
        }),
        undefined,
        false,
      ),
    ).toThrow("closed_at がありません");
  });
});

function createBundle(
  overrides: Partial<PullBundle["pull"]>,
): PullBundle {
  return {
    repository: "VOICEVOX/voicevox",
    pull: {
      number: 1,
      title: "feat: PR",
      body: null,
      html_url: "https://github.com/VOICEVOX/voicevox/pull/1",
      created_at: "2026-07-01T00:00:00Z",
      state: "closed",
      closed_at: "2026-07-10T00:00:00Z",
      user: alice,
      merged_by: bob,
      merged_at: "2026-07-10T00:00:00Z",
      additions: 0,
      deletions: 0,
      changed_files: 0,
      labels: [],
      ...overrides,
    },
    files: [],
    reviews: [],
    reviewComments: [],
    commits: [],
  };
}

async function createFetchScenario(refreshedChangedFiles: number) {
  const cacheDirectory = await mkdtemp(
    resolve(tmpdir(), "voicevox-leaderboard-test-"),
  );
  cacheDirectories.push(cacheDirectory);
  const pullRequestHeaders: Headers[] = [];
  const fileRequestHeaders: Headers[] = [];
  const files = Array.from({ length: 101 }, (_, index) => ({
    filename: "file-" + index + ".txt",
    additions: 1,
    deletions: 0,
  }));
  const fetchMock = vi.fn(
    async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const headers = new Headers(init?.headers);
      if (url.pathname === "/repos/voicevox/voicevox_vvm/pulls/56") {
        pullRequestHeaders.push(headers);
        const changedFiles =
          pullRequestHeaders.length === 1 ? 0 : refreshedChangedFiles;
        return createJsonResponse(
          createGithubPull(changedFiles),
          '"pull-' + pullRequestHeaders.length + '"',
        );
      }
      if (
        url.pathname === "/repos/voicevox/voicevox_vvm/pulls/56/files"
      ) {
        fileRequestHeaders.push(headers);
        const page = url.searchParams.get("page");
        if (page === "1") {
          return createJsonResponse(files.slice(0, 100), '"files-page-1"');
        }
        if (page === "2") {
          return createJsonResponse(files.slice(100), '"files-page-2"');
        }
        throw new Error("想定外の変更ファイル一覧ページです。" + page);
      }
      if (
        url.pathname === "/repos/voicevox/voicevox_vvm/pulls/56/reviews" ||
        url.pathname === "/repos/voicevox/voicevox_vvm/pulls/56/comments" ||
        url.pathname === "/repos/voicevox/voicevox_vvm/pulls/56/commits"
      ) {
        return createJsonResponse([], '"empty"');
      }
      throw new Error("想定外の GitHub API URL です。" + url.href);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  const client = new GitHubApiClient("test-token", cacheDirectory);
  const builder = new DatasetBuilder(client, [
    {
      full_name: "voicevox/voicevox_vvm",
      private: false,
      archived: false,
      fork: false,
      mirror_url: null,
    },
  ]);
  return { builder, pullRequestHeaders, fileRequestHeaders };
}

function createGithubPull(changedFiles: number) {
  return {
    number: 56,
    title: "テスト PR",
    body: null,
    html_url: "https://github.com/voicevox/voicevox_vvm/pull/56",
    created_at: "2026-07-01T00:00:00Z",
    state: "open",
    closed_at: null,
    user: alice,
    merged_by: null,
    merged_at: null,
    additions: changedFiles,
    deletions: 0,
    changed_files: changedFiles,
    labels: [],
  };
}

function createJsonResponse(payload: unknown, etag: string): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ETag: etag,
      "Last-Modified": "Mon, 10 Aug 2026 00:00:00 GMT",
    },
  });
}
