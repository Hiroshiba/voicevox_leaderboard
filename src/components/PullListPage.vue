<script setup lang="ts">
import { computed } from "vue";
import type { DateRange, PreparedPull } from "../domain/model.ts";
import { routeHref } from "../services/routes.ts";

const props = defineProps<{
  pulls: PreparedPull[];
  range: DateRange;
}>();

const sortedPulls = computed(() =>
  props.pulls.toSorted(
    (left, right) =>
      right.mergedAt.localeCompare(left.mergedAt) ||
      left.key.localeCompare(right.key),
  ),
);

const pullsInRange = computed(() =>
  sortedPulls.value.filter((pull) => isInRange(pull.mergedAt)).length,
);

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
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="text-xs font-semibold tracking-[0.18em] text-accent uppercase">
          Pull requests
        </p>
        <h1 class="mt-2 font-display text-3xl font-semibold">
          全 PR
        </h1>
        <p class="mt-3 max-w-2xl text-sm leading-7 text-muted">
          取得済みのマージ済み PR {{ pulls.length }} 件を表示しています。
          選択期間内にマージされた PR は {{ pullsInRange }} 件です。
        </p>
      </div>
      <p class="text-sm text-muted">
        {{ range.start }} — {{ range.end }}
      </p>
    </header>

    <ul class="mt-7 overflow-hidden rounded-2xl border border-line bg-surface">
      <li
        v-for="pull in sortedPulls"
        :key="pull.key"
        class="border-b border-line last:border-b-0"
      >
        <a
          :href="routeHref({ name: 'pull', key: pull.key }, range)"
          class="grid gap-3 px-5 py-4 hover:bg-paper/55 md:grid-cols-[minmax(0,1fr)_12rem_9rem] md:items-center"
        >
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-xs font-semibold text-muted">
                {{ pull.repository }}#{{ pull.number }}
              </span>
              <span
                class="rounded-full px-2 py-0.5 text-[0.7rem] font-semibold"
                :class="isInRange(pull.mergedAt) ? 'bg-accent-soft text-accent-dark' : 'bg-line/60 text-muted'"
              >
                {{ isInRange(pull.mergedAt) ? "期間内" : "期間外" }}
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
            <p>{{ formatDate(pull.mergedAt) }}</p>
            <p class="mt-1 text-xs">
              有効変更 {{ formatLines(pull.effectiveLines) }} 行
            </p>
          </div>
        </a>
      </li>
    </ul>
  </main>
</template>
