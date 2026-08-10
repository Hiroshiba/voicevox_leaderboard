<script setup lang="ts">
import { computed } from "vue";
import { UnreachableError } from "../domain/errors.ts";
import type { DateRange, PreparedPull } from "../domain/model.ts";
import type { RangeSelection } from "../services/calculationScope.ts";
import { routeHref } from "../services/routes.ts";

const props = defineProps<{
  pulls: PreparedPull[];
  range: DateRange;
  rangeSelection: RangeSelection;
}>();

const sortedPulls = computed(() =>
  props.pulls.toSorted(
    (left, right) =>
      pullDate(right).localeCompare(pullDate(left)) ||
      left.key.localeCompare(right.key),
  ),
);

const pullsInRange = computed(() =>
  sortedPulls.value.filter((pull) => isInRange(pullDate(pull))).length,
);

function pullDate(pull: PreparedPull): string {
  const outcome = pull.outcome;
  switch (outcome.kind) {
    case "merged":
      return outcome.mergedAt;
    case "closed":
      return outcome.closedAt;
    case "open":
      return pull.createdAt;
    default:
      throw new UnreachableError(outcome);
  }
}

function outcomeLabel(pull: PreparedPull): string {
  switch (pull.outcome.kind) {
    case "merged":
      return "マージ済み";
    case "closed":
      return "クローズ済み";
    case "open":
      return "オープン";
    default:
      throw new UnreachableError(pull.outcome);
  }
}

function isInRange(timestamp: string): boolean {
  const date = timestamp.slice(0, 10);
  return date >= props.range.start && date <= props.range.end;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
  }).format(new Date(value));
}

function formatLines(lines: number): string {
  return new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits: 1,
  }).format(lines);
}
</script>

<template>
  <main class="mx-auto max-w-7xl px-5 py-10 sm:px-8 sm:py-14">
    <header>
      <p class="text-xs font-semibold tracking-[0.18em] text-accent uppercase">
        Pull requests
      </p>
      <h1 class="mt-2 font-display text-3xl font-semibold">
        全 PR
      </h1>
      <p class="mt-3 max-w-2xl text-sm leading-7 text-muted">
        取得済みの PR {{ pulls.length }} 件を表示しています。
        状態に対応する日付が選択期間内の PR は {{ pullsInRange }} 件です。
      </p>
    </header>

    <ul class="mt-7 overflow-hidden rounded-2xl border border-line bg-surface">
      <li
        v-for="pull in sortedPulls"
        :key="pull.key"
        class="border-b border-line last:border-b-0"
      >
        <a
          :href="routeHref({ name: 'pull', key: pull.key }, rangeSelection)"
          class="grid gap-3 px-5 py-4 hover:bg-paper/55 md:grid-cols-[minmax(0,1fr)_12rem_9rem] md:items-center"
        >
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-xs font-semibold text-muted">
                {{ pull.repository }}#{{ pull.number }}
              </span>
              <span
                class="rounded-full px-2 py-0.5 text-[0.7rem] font-semibold"
                :class="pull.outcome.kind === 'open' ? 'bg-accent-soft text-accent-dark' : 'bg-line/60 text-muted'"
              >
                {{ outcomeLabel(pull) }}
              </span>
              <span
                class="rounded-full px-2 py-0.5 text-[0.7rem] font-semibold"
                :class="isInRange(pullDate(pull)) ? 'bg-accent-soft text-accent-dark' : 'bg-line/60 text-muted'"
              >
                {{ isInRange(pullDate(pull)) ? "期間内" : "期間外" }}
              </span>
            </div>
            <p class="mt-1 font-semibold leading-6">
              {{ pull.title }}
            </p>
          </div>
          <p class="text-sm text-muted">
            {{ pull.author.login }}
          </p>
          <div class="text-sm text-muted md:text-right">
            <p>{{ formatDate(pullDate(pull)) }}</p>
            <p class="mt-1 text-xs">
              有効変更 {{ formatLines(pull.effectiveLines) }} 行
            </p>
          </div>
        </a>
      </li>
    </ul>
  </main>
</template>
