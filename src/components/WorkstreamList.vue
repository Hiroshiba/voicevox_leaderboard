<script setup lang="ts">
import type { LeaderboardResult } from "../domain/model";

defineProps<{
  result: LeaderboardResult;
}>();

function formatScore(score: number): string {
  return score.toFixed(2);
}

function formatLines(lines: number): string {
  return new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits: 1,
  }).format(lines);
}
</script>

<template>
  <section aria-labelledby="workstream-heading">
    <div class="mb-5">
      <p class="mb-1 text-xs font-semibold tracking-[0.18em] text-accent uppercase">
        Calculation trace
      </p>
      <h2
        id="workstream-heading"
        class="font-display text-2xl font-semibold"
      >
        計算単位と根拠
      </h2>
    </div>

    <div class="grid gap-4 xl:grid-cols-2">
      <details
        v-for="workstream in result.workstreams"
        :key="workstream.key"
        class="group h-fit overflow-hidden rounded-2xl border border-line bg-surface"
      >
        <summary class="cursor-pointer list-none p-5">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <span
                class="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent-dark"
              >
                {{ workstream.issue == null ? "独立 PR" : "関連 Issue" }}
              </span>
              <h3 class="mt-3 line-clamp-2 font-semibold leading-snug">
                {{ workstream.title }}
              </h3>
              <p class="mt-1 text-xs text-muted">
                {{ workstream.pulls.length }} PR ・
                {{ workstream.repositoryCount }} リポジトリ
              </p>
            </div>
            <div class="shrink-0 text-right">
              <p class="text-[0.68rem] tracking-wide text-muted uppercase">
                Importance
              </p>
              <p class="font-display text-2xl font-semibold text-accent-dark">
                {{ formatScore(workstream.importance) }}
              </p>
              <span
                aria-hidden="true"
                class="text-muted group-open:rotate-180"
              >⌄</span>
            </div>
          </div>
        </summary>

        <div class="border-t border-line px-5 py-4">
          <dl class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
            <div>
              <dt class="text-xs text-muted">
                有効変更行 E
              </dt>
              <dd class="mt-0.5 font-mono">
                {{ formatLines(workstream.effectiveLines) }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                非生成ファイル F
              </dt>
              <dd class="mt-0.5 font-mono">
                {{ workstream.nonGeneratedFiles }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                リポジトリ R
              </dt>
              <dd class="mt-0.5 font-mono">
                {{ workstream.repositoryCount }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                種別補正 C
              </dt>
              <dd class="mt-0.5 font-mono">
                {{ workstream.conventionalBonus }}
              </dd>
            </div>
          </dl>

          <div class="mt-4 grid grid-cols-3 overflow-hidden rounded-xl border border-line text-center">
            <div class="p-2">
              <p class="text-[0.68rem] text-muted">
                実装
              </p>
              <p class="font-mono text-sm">
                {{ formatScore(workstream.implementationPoints) }}
              </p>
            </div>
            <div class="border-x border-line p-2">
              <p class="text-[0.68rem] text-muted">
                レビュー
              </p>
              <p class="font-mono text-sm">
                {{ formatScore(workstream.reviewPoints) }}
              </p>
            </div>
            <div class="p-2">
              <p class="text-[0.68rem] text-muted">
                Issue
              </p>
              <p class="font-mono text-sm">
                {{ formatScore(workstream.issuePoints) }}
              </p>
            </div>
          </div>

          <ul class="mt-4 space-y-2">
            <li
              v-for="pull in workstream.pulls"
              :key="pull.key"
              class="text-sm"
            >
              <a
                :href="pull.url"
                target="_blank"
                rel="noreferrer"
                class="font-medium hover:text-accent"
              >
                {{ pull.repository }}#{{ pull.number }}
              </a>
              <span class="ml-2 text-xs text-muted">
                E {{ formatLines(pull.effectiveLines) }} ・ F
                {{ pull.nonGeneratedFiles }} ・ M {{ formatScore(pull.mass) }}
              </span>
            </li>
          </ul>
        </div>
      </details>
    </div>

    <div
      v-if="result.standaloneIssues.length > 0"
      class="mt-8"
    >
      <h3 class="font-display text-lg font-semibold">
        PR にならなかった Issue
      </h3>
      <div class="mt-3 overflow-hidden rounded-2xl border border-line bg-surface">
        <a
          v-for="issue in result.standaloneIssues"
          :key="issue.key"
          :href="issue.url"
          target="_blank"
          rel="noreferrer"
          class="grid gap-2 border-b border-line px-4 py-3 last:border-b-0 hover:bg-paper/60 sm:grid-cols-[minmax(0,1fr)_auto]"
        >
          <div class="min-w-0">
            <p class="font-medium">{{ issue.repository }}#{{ issue.number }} {{ issue.title }}</p>
            <p class="mt-1 text-xs text-muted">
              状態 {{ issue.statusBonus }} ・ 証拠 {{ issue.evidenceCount }} 種 ・
              実質的コメント {{ issue.substantiveCommentCount }} 件 ・ 参加者
              {{ issue.participantCount }} 人
            </p>
          </div>
          <p class="font-display text-lg font-semibold text-accent-dark">
            {{ formatScore(issue.score) }}
          </p>
        </a>
      </div>
    </div>
  </section>
</template>
