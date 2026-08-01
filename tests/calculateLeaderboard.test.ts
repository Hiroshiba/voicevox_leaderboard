import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateLeaderboard } from "../src/services/calculateLeaderboard";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("calculateLeaderboard", () => {
  it("期間内に作成されて期間後に閉じた Issue を期間末時点の Open Issue として数える", async () => {
    const queries: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.pathname === "/search/issues") {
          const query = url.searchParams.get("q");
          if (query == null) {
            throw new Error("GitHub Search のクエリがありません。");
          }
          queries.push(query);
          const numbers =
            query.includes("is:issue created:2025-10-14..2025-10-14")
              ? [2790]
              : [];
          return jsonResponse({
            total_count: numbers.length,
            incomplete_results: false,
            items: numbers.map((number) => ({ number })),
          });
        }
        if (url.pathname.endsWith("/issues/2790/comments")) {
          return jsonResponse([]);
        }
        if (url.pathname.endsWith("/issues/2790")) {
          return jsonResponse({
            number: 2790,
            title: "ビルドキャッシュが配布物へ含まれる",
            body: "Ubuntu 24.04 で確認したところ容量は 950 MB でした。",
            html_url: "https://github.com/VOICEVOX/voicevox/issues/2790",
            user: userPayload("reporter"),
            state: "closed",
            state_reason: "completed",
            created_at: "2025-10-14T08:38:19Z",
            closed_at: "2025-10-15T16:02:23Z",
            updated_at: "2025-10-15T16:10:51Z",
            labels: [],
          });
        }
        throw new Error("想定していない URL です: " + url.toString());
      }),
    );

    const result = await calculateLeaderboard(
      {
        organization: "VOICEVOX",
        repositories: ["VOICEVOX/voicevox"],
        range: {
          start: "2025-10-14",
          end: "2025-10-14",
        },
      },
      "",
      vi.fn(),
    );

    expect(result.standaloneIssues).toHaveLength(1);
    expect(result.standaloneIssues[0]).toMatchObject({
      number: 2790,
      statusBonus: 1,
    });
    expect(queries).toEqual(
      expect.arrayContaining([
        "repo:VOICEVOX/voicevox is:issue updated:2025-10-14..2025-10-14",
        "repo:VOICEVOX/voicevox is:issue created:2025-10-14..2025-10-14",
        "repo:VOICEVOX/voicevox is:issue closed:2025-10-14..2025-10-14",
      ]),
    );
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

function userPayload(login: string): object {
  return {
    login,
    avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
    html_url: "https://github.com/" + login,
    type: "User",
  };
}
