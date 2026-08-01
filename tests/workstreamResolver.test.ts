import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubClient } from "../src/services/githubClient";
import { pullSchema } from "../src/services/githubSchemas";
import { WorkstreamResolver } from "../src/services/workstreamResolver";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WorkstreamResolver", () => {
  it("通常の Issue 参照を関連 PR として採用しない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          issuePayload(10, "https://github.com/VOICEVOX/voicevox/issues/10"),
        ),
      ),
    );
    const resolver = new WorkstreamResolver(new GitHubClient(""), "VOICEVOX");
    const pull = pullSchema.parse({
      ...pullPayload(1, "See #10"),
      html_url: "https://github.com/VOICEVOX/voicevox/pull/1",
    });

    await expect(
      resolver.resolve({
        repository: "VOICEVOX/voicevox",
        pull,
      }),
    ).resolves.toBeUndefined();
  });

  it("関連 PR の主 Issue を 1 段だけたどる", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/issues/20")) {
          return jsonResponse({
            ...issuePayload(
              20,
              "https://github.com/VOICEVOX/voicevox/pull/20",
            ),
            pull_request: {
              url: "https://api.github.com/repos/VOICEVOX/voicevox/pulls/20",
            },
          });
        }
        if (url.endsWith("/pulls/20")) {
          return jsonResponse({
            ...pullPayload(20, "Fixes #30"),
            html_url: "https://github.com/VOICEVOX/voicevox/pull/20",
          });
        }
        if (url.endsWith("/issues/30")) {
          return jsonResponse(
            issuePayload(
              30,
              "https://github.com/VOICEVOX/voicevox/issues/30",
            ),
          );
        }
        throw new Error("想定していない URL です: " + url);
      }),
    );
    const resolver = new WorkstreamResolver(new GitHubClient(""), "VOICEVOX");
    const pull = pullSchema.parse({
      ...pullPayload(1, "See #20"),
      html_url: "https://github.com/VOICEVOX/voicevox/pull/1",
    });

    const resolved = await resolver.resolve({
      repository: "VOICEVOX/voicevox",
      pull,
    });

    expect(resolved?.key).toBe("voicevox/voicevox#30");
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function pullPayload(number: number, body: string): object {
  return {
    number,
    title: "test: テスト",
    body,
    html_url: "https://github.com/VOICEVOX/voicevox/pull/" + number,
    user: userPayload("author"),
    merged_at: "2026-07-01T00:00:00Z",
    additions: 1,
    deletions: 0,
    changed_files: 1,
    labels: [],
  };
}

function issuePayload(number: number, htmlUrl: string): object {
  return {
    number,
    title: "Issue " + number,
    body: "",
    html_url: htmlUrl,
    user: userPayload("reporter"),
    state: "open",
    state_reason: null,
    created_at: "2026-07-01T00:00:00Z",
    closed_at: null,
    updated_at: "2026-07-01T00:00:00Z",
    labels: [],
  };
}

function userPayload(login: string): object {
  return {
    login,
    avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
    html_url: "https://github.com/" + login,
    type: "User",
  };
}
