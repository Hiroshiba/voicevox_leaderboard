/// <reference types="node" />

import { describe, expect, it } from "vitest";
import { preparePull } from "../scripts/fetchGithubData.ts";

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
