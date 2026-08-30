<script setup lang="ts">
import { computed } from "vue";
import { assertNonNullable } from "../domain/errors.ts";
import type { LeaderboardResult } from "../domain/model.ts";
import type { RangeSelection } from "../services/calculationScope.ts";
import { routeHref } from "../services/routes.ts";
import ScoreBreakdownBar from "./ScoreBreakdownBar.vue";

const props = defineProps<{
  result: LeaderboardResult;
  rangeSelection: RangeSelection;
}>();

const maximumContributorPoints = computed(() => {
  const firstContributor = props.result.contributors[0];
  assertNonNullable(
    firstContributor,
    "最大点の算出対象となる貢献者がいません。",
  );
  return props.result.contributors.reduce(
    (maximumPoints, contributor) =>
      Math.max(maximumPoints, contributor.score),
    firstContributor.score,
  );
});

function formatScore(score: number): string {
  return score.toFixed(2);
}
</script>

<template>
  <section aria-labelledby="leaderboard-heading">
    <div class="mb-5">
      <p class="mb-1 text-xs font-semibold tracking-[0.18em] text-accent uppercase">
        Contribution ranking
      </p>
      <h2
        id="leaderboard-heading"
        class="font-display text-2xl font-semibold"
      >
        貢献者リーダーボード
      </h2>
    </div>

    <div
      v-if="result.contributors.length === 0"
      class="rounded-2xl border border-line bg-surface px-6 py-12 text-center"
    >
      <p class="font-semibold">
        配点対象の貢献が見つかりませんでした
      </p>
      <p class="mt-2 text-sm text-muted">
        取得済み期間内で対象期間を広げてください。
      </p>
    </div>

    <div
      v-else
      class="overflow-x-auto rounded-2xl border border-line bg-surface shadow-table"
    >
      <table class="w-full min-w-[44rem] border-collapse text-left">
        <thead class="border-b border-line bg-paper/55 text-xs text-muted">
          <tr>
            <th class="w-16 px-5 py-3 text-center font-semibold">
              順位
            </th>
            <th class="px-4 py-3 font-semibold">
              人物
            </th>
            <th class="w-[25rem] px-4 py-3 font-semibold">
              点数内訳
            </th>
            <th class="px-5 py-3 text-right font-semibold">
              合計
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="contributor in result.contributors"
            :key="contributor.login"
            class="border-b border-line last:border-b-0 hover:bg-paper/45"
          >
            <td
              class="px-5 py-4 text-center font-display text-lg font-semibold"
              :class="contributor.rank <= 3 ? 'text-accent-dark' : 'text-muted'"
            >
              {{ contributor.rank }}
            </td>
            <td class="px-4 py-4">
              <a
                :href="routeHref({ name: 'person', login: contributor.login }, rangeSelection)"
                class="flex items-center gap-3 font-semibold hover:text-accent"
              >
                <img
                  :src="contributor.avatarUrl"
                  :alt="contributor.login + ' のアバター'"
                  class="size-10 rounded-full border border-line bg-paper"
                >
                {{ contributor.login }}
              </a>
            </td>
            <td class="px-4 py-4">
              <ScoreBreakdownBar
                :breakdown="{
                  type: 'allocated',
                  implementationPoints: contributor.implementationPoints,
                  reviewPoints: contributor.reviewPoints,
                  issuePoints: contributor.issuePoints,
                }"
                density="compact"
                :maximum-points="maximumContributorPoints"
              />
            </td>
            <td class="px-5 py-4 text-right font-display text-xl font-semibold text-accent-dark">
              {{ formatScore(contributor.score) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
