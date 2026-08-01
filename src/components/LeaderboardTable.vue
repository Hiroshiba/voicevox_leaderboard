<script setup lang="ts">
import type { LeaderboardResult } from "../domain/model";
import { contributionKindLabel } from "../domain/scoring";

defineProps<{
  result: LeaderboardResult;
}>();

function formatScore(score: number): string {
  return score.toFixed(2);
}

function kindClass(kind: "implementation" | "review" | "issue"): string {
  if (kind === "implementation") {
    return "bg-emerald-100 text-emerald-800";
  }
  if (kind === "review") {
    return "bg-blue-100 text-blue-800";
  }
  return "bg-amber-100 text-amber-900";
}
</script>

<template>
  <section aria-labelledby="leaderboard-heading">
    <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="mb-1 text-xs font-semibold tracking-[0.18em] text-accent uppercase">
          Contribution ranking
        </p>
        <h2
          id="leaderboard-heading"
          class="font-display text-2xl font-semibold text-ink"
        >
          貢献者リーダーボード
        </h2>
      </div>
      <p class="text-sm text-muted">
        {{ result.scope.range.start }} — {{ result.scope.range.end }}
      </p>
    </div>

    <div
      v-if="result.contributors.length === 0"
      class="rounded-2xl border border-line bg-surface px-6 py-12 text-center"
    >
      <p class="font-semibold">
        配点対象の貢献が見つかりませんでした
      </p>
      <p class="mt-2 text-sm text-muted">
        期間または対象リポジトリを広げて再計算してください。
      </p>
    </div>

    <div
      v-else
      class="space-y-3"
    >
      <details
        v-for="contributor in result.contributors"
        :key="contributor.login"
        class="group overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_8px_24px_rgba(34,52,45,0.04)]"
      >
        <summary
          class="grid cursor-pointer list-none grid-cols-[2.5rem_3rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 sm:grid-cols-[3rem_3rem_minmax(0,1fr)_7rem_7rem_7rem_auto] sm:px-6"
        >
          <span
            class="font-display text-center text-xl font-semibold"
            :class="contributor.rank <= 3 ? 'text-accent-dark' : 'text-muted'"
          >
            {{ contributor.rank }}
          </span>
          <img
            :src="contributor.avatarUrl"
            :alt="contributor.login + ' のアバター'"
            class="size-11 rounded-full border border-line bg-paper"
          >
          <div class="min-w-0">
            <a
              :href="contributor.profileUrl"
              target="_blank"
              rel="noreferrer"
              class="truncate font-semibold hover:text-accent"
              @click.stop
            >
              {{ contributor.login }}
            </a>
            <p class="mt-0.5 text-xs text-muted sm:hidden">
              実装 {{ formatScore(contributor.implementationPoints) }} ・ レビュー
              {{ formatScore(contributor.reviewPoints) }} ・ Issue
              {{ formatScore(contributor.issuePoints) }}
            </p>
          </div>
          <div class="hidden text-right sm:block">
            <p class="text-[0.68rem] tracking-wide text-muted uppercase">
              実装
            </p>
            <p class="font-mono text-sm">
              {{ formatScore(contributor.implementationPoints) }}
            </p>
          </div>
          <div class="hidden text-right sm:block">
            <p class="text-[0.68rem] tracking-wide text-muted uppercase">
              レビュー
            </p>
            <p class="font-mono text-sm">
              {{ formatScore(contributor.reviewPoints) }}
            </p>
          </div>
          <div class="hidden text-right sm:block">
            <p class="text-[0.68rem] tracking-wide text-muted uppercase">
              Issue
            </p>
            <p class="font-mono text-sm">
              {{ formatScore(contributor.issuePoints) }}
            </p>
          </div>
          <div class="flex min-w-[5rem] items-center justify-end gap-3 text-right">
            <div>
              <p class="text-[0.68rem] tracking-wide text-muted uppercase">
                Score
              </p>
              <p class="font-display text-xl font-semibold text-accent-dark">
                {{ formatScore(contributor.score) }}
              </p>
            </div>
            <span
              aria-hidden="true"
              class="text-lg text-muted group-open:rotate-180"
            >⌄</span>
          </div>
        </summary>

        <div class="border-t border-line bg-paper/45 px-4 py-4 sm:px-6">
          <p class="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">
            算出元
          </p>
          <ul class="space-y-2">
            <li
              v-for="entry in contributor.entries"
              :key="entry.kind + ':' + entry.sourceKey + ':' + entry.reason"
              class="grid gap-2 rounded-xl bg-surface p-3 sm:grid-cols-[6rem_minmax(0,1fr)_5rem]"
            >
              <span
                class="h-fit w-fit rounded-full px-2.5 py-1 text-xs font-semibold"
                :class="kindClass(entry.kind)"
              >
                {{ contributionKindLabel(entry.kind) }}
              </span>
              <div class="min-w-0">
                <a
                  :href="entry.sourceUrl"
                  target="_blank"
                  rel="noreferrer"
                  class="font-medium hover:text-accent"
                >
                  {{ entry.sourceTitle }}
                </a>
                <p class="mt-1 text-xs leading-relaxed text-muted">
                  {{ entry.reason }}
                </p>
              </div>
              <p class="text-right font-mono font-semibold text-accent-dark">
                +{{ formatScore(entry.points) }}
              </p>
            </li>
          </ul>
        </div>
      </details>
    </div>
  </section>
</template>
