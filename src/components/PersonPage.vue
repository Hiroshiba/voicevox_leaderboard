<script setup lang="ts">
import { computed } from "vue";
import type {
  ContributionKind,
  ContributorScore,
  LeaderboardResult,
} from "../domain/model.ts";
import { contributionKindLabel } from "../domain/scoring.ts";
import type { RangeSelection } from "../services/calculationScope.ts";
import { routeHref, sourceHref } from "../services/routes.ts";
import type { SankeyDiagramSelection } from "../services/sankeyDiagram.ts";
import SankeyDiagram from "./SankeyDiagram.vue";
import ScoreBreakdownBar from "./ScoreBreakdownBar.vue";

const props = defineProps<{
  contributor: ContributorScore;
  result: LeaderboardResult;
  rangeSelection: RangeSelection;
}>();

const githubProfileUrl =
  "https://github.com/" + encodeURIComponent(props.contributor.login);
const sankeySelection = computed<SankeyDiagramSelection>(() => ({
  type: "contributor",
  contributor: props.contributor,
}));

function formatScore(score: number): string {
  return score.toFixed(2);
}

function kindClass(kind: ContributionKind): string {
  switch (kind) {
    case "implementation":
      return "bg-kind-implementation-soft text-kind-implementation-ink";
    case "review":
      return "bg-kind-review-soft text-kind-review-ink";
    case "issue":
      return "bg-kind-issue-soft text-kind-issue-ink";
  }
}
</script>

<template>
  <main class="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-12">
    <a
      :href="routeHref({ name: 'home' }, rangeSelection)"
      class="text-sm font-semibold text-accent hover:underline"
    >
      ← リーダーボードへ戻る
    </a>

    <section class="mt-6 rounded-3xl border border-line bg-surface p-6 sm:p-8">
      <div class="flex flex-wrap items-start justify-between gap-6">
        <div class="flex items-center gap-4">
          <img
            :src="contributor.avatarUrl"
            :alt="contributor.login + ' のアバター'"
            class="size-16 rounded-full border border-line bg-paper"
          >
          <div>
            <p class="text-xs font-semibold tracking-[0.18em] text-accent uppercase">
              Contributor
            </p>
            <h1 class="mt-1 font-display text-3xl font-semibold">
              {{ contributor.login }}
            </h1>
            <p class="mt-1 text-sm text-muted">
              {{ contributor.rank }} 位
            </p>
          </div>
        </div>
        <div class="text-right">
          <p class="text-xs text-muted">
            Contribution Score
          </p>
          <p class="font-display text-4xl font-semibold text-accent-dark">
            {{ formatScore(contributor.score) }}
          </p>
          <a
            :href="githubProfileUrl"
            target="_blank"
            rel="noreferrer"
            class="mt-2 inline-block text-sm font-semibold text-accent hover:underline"
          >
            GitHub プロフィールを開く ↗
          </a>
        </div>
      </div>

      <div class="mt-7 border-y border-line py-4">
        <p class="mb-3 text-xs font-semibold text-muted">
          点数内訳
        </p>
        <ScoreBreakdownBar
          :breakdown="{
            type: 'allocated',
            implementationPoints: contributor.implementationPoints,
            reviewPoints: contributor.reviewPoints,
            issuePoints: contributor.issuePoints,
          }"
          density="comfortable"
          :maximum-points="contributor.score"
        />
      </div>
    </section>

    <section
      class="mt-10"
      aria-labelledby="sankey-heading"
    >
      <p class="mb-1 text-xs font-semibold tracking-[0.18em] text-accent uppercase">
        Score flow
      </p>
      <h2
        id="sankey-heading"
        class="font-display text-2xl font-semibold"
      >
        ポイントの発生源
      </h2>
      <p class="mt-2 mb-5 max-w-3xl text-sm leading-7 text-muted">
        左列の PR、中列の Issue、右列の人物をたどって配点元を確認できます。
        実装とレビューは PR から人物へ直接つながるため、Issue の列を飛び越えます。
        Issue・調査は関連 PR から Issue を経て人物へつながり、独立 Issue は中列から始まります。
        同じ PR、Issue、人物は一つのノードにまとめ、配点対象外の点は表示しません。
      </p>
      <SankeyDiagram
        :result="result"
        :selection="sankeySelection"
        :range-selection="rangeSelection"
      />
    </section>

    <section
      class="mt-10"
      aria-labelledby="entries-heading"
    >
      <h2
        id="entries-heading"
        class="font-display text-2xl font-semibold"
      >
        配点明細
      </h2>
      <ul class="mt-5 space-y-3">
        <li
          v-for="entry in contributor.entries"
          :key="entry.id"
          class="grid gap-3 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-[7rem_minmax(0,1fr)_6rem]"
        >
          <span
            class="h-fit w-fit rounded-full px-2.5 py-1 text-xs font-semibold"
            :class="kindClass(entry.kind)"
          >
            {{ contributionKindLabel(entry.kind) }}
          </span>
          <div class="min-w-0">
            <a
              :href="sourceHref(entry.source, rangeSelection)"
              class="font-semibold hover:text-accent"
            >
              {{ entry.sourceTitle }}
            </a>
            <p class="mt-1 text-xs leading-6 text-muted">
              {{ entry.reason }}
            </p>
          </div>
          <p class="text-right font-mono font-semibold text-accent-dark">
            +{{ formatScore(entry.points) }}
          </p>
        </li>
      </ul>
    </section>
  </main>
</template>
