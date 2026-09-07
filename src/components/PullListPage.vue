<script setup lang="ts">
import { computed } from "vue";
import { UnreachableError } from "../domain/errors.ts";
import type {
  DateRange,
  PreparedPull,
  PullOutcome,
  UnmeasuredReason,
} from "../domain/model.ts";
import {
  calculateEditMeasurementSummary,
  getPullScoringDate,
  resolvePullOutcomeAtRangeEnd,
} from "../domain/scoring.ts";
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
  return getPullScoringDate(pull.createdAt, pullOutcome(pull));
}

function pullOutcome(pull: PreparedPull): PullOutcome {
  return resolvePullOutcomeAtRangeEnd(pull.outcome, props.range.end);
}

function pullDateLabel(pull: PreparedPull): string {
  const outcome = pullOutcome(pull);
  switch (outcome.kind) {
    case "merged":
      return "マージ日 " + formatDate(outcome.mergedAt);
    case "closed":
      return "クローズ日 " + formatDate(outcome.closedAt);
    case "open":
      return "作成日 " + formatDate(pull.createdAt);
    default:
      throw new UnreachableError(outcome);
  }
}

function outcomeLabel(pull: PreparedPull): string {
  const outcome = pullOutcome(pull);
  switch (outcome.kind) {
    case "merged":
      return "マージ済み";
    case "closed":
      return "クローズ済み";
    case "open":
      return "オープン";
    default:
      throw new UnreachableError(outcome);
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

function formatAmount(amount: number): string {
  return new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits: 1,
  }).format(amount);
}

function pullMeasurementLabel(pull: PreparedPull): string {
  const summary = calculateEditMeasurementSummary(pull.files);
  const unmeasured =
    summary.unmeasuredFileCount === 0
      ? ""
      : "、未測定 " +
        summary.unmeasuredFileCount +
        " 件" +
        " " +
        unmeasuredReasonsLabel(summary.unmeasuredReasons);
  return (
    "通常 " +
    formatAmount(summary.uncompressedEditAmount) +
    "、PR内圧縮後 " +
    formatAmount(summary.editAmount) +
    "、生成物 " +
    summary.generatedFileCount +
    " 件" +
    unmeasured
  );
}

function unmeasuredReasonsLabel(
  reasons: Record<UnmeasuredReason, number>,
): string {
  const labels: string[] = [];
  for (const reason of [
    "patchMissing",
    "patchTruncated",
    "binary",
    "unsupported",
  ] satisfies UnmeasuredReason[]) {
    const count = reasons[reason];
    if (count > 0) {
      labels.push(unmeasuredReasonLabel(reason) + " " + count + " 件");
    }
  }
  return labels.join("、");
}

function unmeasuredReasonLabel(reason: UnmeasuredReason): string {
  switch (reason) {
    case "patchMissing":
      return "patch なし";
    case "patchTruncated":
      return "patch 不完全";
    case "binary":
      return "バイナリ";
    case "unsupported":
      return "未対応形式";
    default:
      throw new UnreachableError(reason);
  }
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
        取得済みの PR {{ pulls.length }} 件を、選択期間末の状態と配点対象日で表示しています。
        配点対象日が選択期間内の PR は {{ pullsInRange }} 件です。
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
                :class="pullOutcome(pull).kind === 'open' ? 'bg-accent-soft text-accent-dark' : 'bg-line/60 text-muted'"
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
            <p>{{ pullDateLabel(pull) }}</p>
            <p class="mt-1 text-xs">
              {{ pullMeasurementLabel(pull) }}
            </p>
          </div>
        </a>
      </li>
    </ul>
  </main>
</template>
