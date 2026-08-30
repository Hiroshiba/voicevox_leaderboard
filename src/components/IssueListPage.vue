<script setup lang="ts">
import { computed } from "vue";
import type { DateRange, PreparedIssue } from "../domain/model.ts";
import type { RangeSelection } from "../services/calculationScope.ts";
import { routeHref } from "../services/routes.ts";

const props = defineProps<{
  issues: PreparedIssue[];
  range: DateRange;
  rangeSelection: RangeSelection;
}>();

const sortedIssues = computed(() =>
  props.issues.toSorted(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) ||
      left.key.localeCompare(right.key),
  ),
);

const issuesWithActivityInRange = computed(() =>
  sortedIssues.value.filter(hasActivityInRange).length,
);

function hasActivityInRange(issue: PreparedIssue): boolean {
  return [
    issue.createdAt,
    ...(issue.closedAt == null ? [] : [issue.closedAt]),
    ...issue.comments.map((comment) => comment.createdAt),
  ].some((timestamp) => isInRange(timestamp));
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
</script>

<template>
  <main class="mx-auto max-w-7xl px-5 py-10 sm:px-8 sm:py-14">
    <header>
      <p class="text-xs font-semibold tracking-[0.18em] text-accent uppercase">
        Issues
      </p>
      <h1 class="mt-2 font-display text-3xl font-semibold">
        全 Issue
      </h1>
      <p class="mt-3 max-w-2xl text-sm leading-7 text-muted">
        取得済みの Issue {{ issues.length }} 件を表示しています。
        選択期間内に作成、Close、コメントのいずれかがあった Issue は
        {{ issuesWithActivityInRange }} 件です。
      </p>
    </header>

    <ul class="mt-7 overflow-hidden rounded-2xl border border-line bg-surface">
      <li
        v-for="issue in sortedIssues"
        :key="issue.key"
        class="border-b border-line last:border-b-0"
      >
        <a
          :href="routeHref({ name: 'issue', key: issue.key }, rangeSelection)"
          class="grid gap-3 px-5 py-4 hover:bg-paper/55 md:grid-cols-[minmax(0,1fr)_10rem_9rem] md:items-center"
        >
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-xs font-semibold text-muted">
                {{ issue.repository }}#{{ issue.number }}
              </span>
              <span
                class="rounded-full px-2 py-0.5 text-[0.7rem] font-semibold"
                :class="issue.state === 'open' ? 'bg-accent-soft text-accent-dark' : 'bg-line/60 text-muted'"
              >
                {{ issue.state === "open" ? "Open" : "Closed" }}
              </span>
              <span
                v-if="hasActivityInRange(issue)"
                class="rounded-full bg-kind-issue-soft px-2 py-0.5 text-[0.7rem] font-semibold text-kind-issue-ink"
              >
                期間内に活動あり
              </span>
            </div>
            <p class="mt-1 font-semibold leading-6">
              {{ issue.title }}
            </p>
          </div>
          <p class="text-sm text-muted">
            {{ issue.author?.login ?? "作者記録なし" }}
          </p>
          <p class="text-sm text-muted md:text-right">
            {{ formatDate(issue.createdAt) }}
          </p>
        </a>
      </li>
    </ul>
  </main>
</template>
