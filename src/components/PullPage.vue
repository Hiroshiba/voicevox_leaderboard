<script setup lang="ts">
import { computed } from "vue";
import { assertNonNullable, UnreachableError } from "../domain/errors.ts";
import type {
  ContributionKind,
  DateRange,
  FileScore,
  LeaderboardResult,
  PreparedPull,
  UnmeasuredReason,
  WorkstreamScore,
} from "../domain/model.ts";
import {
  calculateAiActivityCredit,
  calculateEditMeasurementSummary,
  calculateImplementationReviewAssurance,
  calculateImplementationStateCredit,
  contributionKindLabel,
  getPullScoringDate,
  resolvePullOutcomeAtRangeEnd,
} from "../domain/scoring.ts";
import type { RangeSelection } from "../services/calculationScope.ts";
import { routeHref } from "../services/routes.ts";
import type { SankeyDiagramSelection } from "../services/sankeyDiagram.ts";
import SankeyDiagram from "./SankeyDiagram.vue";
import ScoreBreakdownBar from "./ScoreBreakdownBar.vue";

const props = defineProps<{
  pull: PreparedPull;
  workstream?: WorkstreamScore | undefined;
  range: DateRange;
  result: LeaderboardResult;
  rangeSelection: RangeSelection;
}>();

const sankeySelection = computed<SankeyDiagramSelection>(() => ({
  type: "pull",
  key: props.pull.key,
}));
const hasSankeyData = computed(
  () =>
    props.workstream != null && props.workstream.allocations.length > 0,
);
const pullAtRangeEnd = computed<PreparedPull>(() => ({
  ...props.pull,
  outcome: resolvePullOutcomeAtRangeEnd(props.pull.outcome, props.range.end),
}));
const reviewAssurance = computed(() =>
  calculateImplementationReviewAssurance(
    pullAtRangeEnd.value,
    props.range.end,
  ),
);
const activityCredit = computed(() =>
  calculateAiActivityCredit(props.pull.fullAiImplementation),
);
const stateCredit = computed(() =>
  calculateImplementationStateCredit(pullAtRangeEnd.value.outcome),
);
const scoringDateInRange = computed(() => {
  const scoringDate = getPullScoringDate(
    props.pull.createdAt,
    pullAtRangeEnd.value.outcome,
  ).slice(0, 10);
  return scoringDate >= props.range.start && scoringDate <= props.range.end;
});
const implementationCreditPercent = computed(() =>
  Math.round(
    activityCredit.value.creditRatio *
      reviewAssurance.value.creditRatio *
      stateCredit.value.creditRatio *
      100,
  ),
);
const pullEditSummary = computed(() =>
  calculateEditMeasurementSummary(props.pull.files),
);
const workstreamPullContribution = computed(() => {
  if (props.workstream == null) {
    return undefined;
  }
  const contribution = props.workstream.pullEditContributions.find(
    (candidate) => candidate.pullKey === props.pull.key,
  );
  assertNonNullable(
    contribution,
    props.pull.key + " のワークストリーム編集寄与量がありません。",
  );
  return contribution.amount;
});

const outcomeDateLabel = computed(() => {
  const outcome = pullAtRangeEnd.value.outcome;
  switch (outcome.kind) {
    case "merged":
      return formatDate(outcome.mergedAt) + " にマージ";
    case "closed":
      return formatDate(outcome.closedAt) + " にクローズ";
    case "open":
      return formatDate(props.pull.createdAt) + " に作成";
    default:
      throw new UnreachableError(outcome);
  }
});

function formatScore(score: number): string {
  return score.toFixed(2);
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits: 1,
  }).format(amount);
}

function fileAnalysisLabel(file: FileScore): string {
  switch (file.analysis.kind) {
    case "measured":
      return "測定済み " + file.analysis.groups.length + " グループ";
    case "generated":
      return "生成物";
    case "unmeasured":
      return "未測定 " + unmeasuredReasonLabel(file.analysis.reason);
    default:
      throw new UnreachableError(file.analysis);
  }
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

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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
  <main class="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
    <a
      :href="routeHref({ name: 'home' }, rangeSelection)"
      class="text-sm font-semibold text-accent hover:underline"
    >
      ← リーダーボードへ戻る
    </a>

    <article class="mt-6 rounded-3xl border border-line bg-surface p-6 sm:p-8">
      <p class="text-xs font-semibold tracking-[0.18em] text-accent uppercase">
        Pull request
      </p>
      <p class="mt-3 text-sm font-semibold text-muted">
        {{ pull.repository }}#{{ pull.number }}
      </p>
      <h1 class="mt-2 max-w-4xl font-display text-3xl leading-tight font-semibold">
        {{ pull.title }}
      </h1>
      <div class="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
        <a
          :href="routeHref({ name: 'person', login: pull.author.login }, rangeSelection)"
          class="flex items-center gap-2 font-semibold text-ink hover:text-accent"
        >
          <img
            :src="pull.author.avatarUrl"
            :alt="pull.author.login + ' のアバター'"
            class="size-7 rounded-full border border-line"
          >
          {{ pull.author.login }}
        </a>
        <span>{{ outcomeDateLabel }}</span>
        <a
          :href="pull.githubUrl"
          target="_blank"
          rel="noreferrer"
          class="font-semibold text-accent hover:underline"
        >
          GitHub で PR を開く ↗
        </a>
      </div>

      <dl class="mt-7 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div class="rounded-xl bg-paper/70 p-4">
          <dt class="text-xs text-muted">
            通常編集量
          </dt>
          <dd class="mt-1 font-mono text-lg">
            {{ formatAmount(pullEditSummary.uncompressedEditAmount) }}
          </dd>
        </div>
        <div class="rounded-xl bg-paper/70 p-4">
          <dt class="text-xs text-muted">
            PR 内の圧縮後編集量
          </dt>
          <dd class="mt-1 font-mono text-lg">
            {{ formatAmount(pullEditSummary.editAmount) }}
          </dd>
        </div>
        <div class="rounded-xl bg-paper/70 p-4">
          <dt class="text-xs text-muted">
            生成物
          </dt>
          <dd class="mt-1 font-mono text-lg">
            {{ pullEditSummary.generatedFileCount }} 件
          </dd>
        </div>
        <div class="rounded-xl bg-paper/70 p-4">
          <dt class="text-xs text-muted">
            種別補正 C
          </dt>
          <dd class="mt-1 font-mono text-lg">
            {{ pull.conventionalBonus }}
          </dd>
        </div>
      </dl>
      <div
        class="mt-4 rounded-xl bg-paper/70 px-4 py-3 text-sm leading-6 text-muted"
      >
        <p>
          <span class="font-semibold text-ink">活動区分</span>
          {{ activityCredit.label }}
        </p>
        <p>
          <span class="font-semibold text-ink">未測定</span>
          {{ pullEditSummary.unmeasuredFileCount }} 件
          <span v-if="pullEditSummary.unmeasuredFileCount > 0">
            {{ unmeasuredReasonsLabel(pullEditSummary.unmeasuredReasons) }}
          </span>
        </p>
        <p v-if="workstreamPullContribution != null">
          <span class="font-semibold text-ink">ワークストリーム配分寄与量</span>
          {{ formatAmount(workstreamPullContribution) }}
        </p>
        <p>
          <span class="font-semibold text-ink">状態係数</span>
          選択期間末は{{ stateCredit.label }}のため、実装枠を
          {{ stateCredit.creditRatio }} 倍にします。
        </p>
        <p>
          <span class="font-semibold text-ink">レビュー保証</span>
          {{ reviewAssurance.label }}
        </p>
        <p v-if="scoringDateInRange">
          この PR に割り当てられた実装枠の
          {{ implementationCreditPercent }}%を作者と共同作者へ配分します。
        </p>
        <p v-else>
          配点対象日が選択期間外のため、この期間は実装枠を配分しません。
        </p>
        <p v-if="pull.fullAiImplementation">
          変更ファイルはすべて生成物として数えます。
        </p>
      </div>
    </article>

    <section
      class="mt-10"
      aria-labelledby="pull-sankey-heading"
    >
      <p class="mb-1 text-xs font-semibold tracking-[0.18em] text-accent uppercase">
        Score flow
      </p>
      <h2
        id="pull-sankey-heading"
        class="font-display text-2xl font-semibold"
      >
        この PR からのポイント経路
      </h2>
      <p class="mt-2 mb-5 max-w-3xl text-sm leading-7 text-muted">
        実装とレビューは PR から人物へ直接流れます。
        マージ済み PR の Issue・調査は関連 Issue を経由して人物へ流れ、未マージ PR の関連 Issue は独立して採点します。
        同じ成果に含まれる別のマージ済み PR がある場合は、その経路も比較できるように表示します。
      </p>
      <SankeyDiagram
        v-if="hasSankeyData"
        :result="result"
        :selection="sankeySelection"
        :range-selection="rangeSelection"
      />
      <div
        v-else
        class="rounded-2xl border border-line bg-surface px-6 py-10 text-center"
      >
        <p class="font-semibold">
          選択期間にはこの PR からの配点がありません
        </p>
        <p class="mt-2 text-sm text-muted">
          配点対象日が期間外、または実装とレビューの配点条件を満たす活動がないためです。
        </p>
      </div>
    </section>

    <section
      v-if="workstream != null"
      class="mt-8 rounded-3xl border border-line bg-surface p-6 sm:p-8"
      aria-labelledby="workstream-detail-heading"
    >
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="text-xs font-semibold tracking-[0.18em] text-accent uppercase">
            Workstream
          </p>
          <h2
            id="workstream-detail-heading"
            class="mt-2 font-display text-2xl font-semibold"
          >
            {{ workstream.title }}
          </h2>
          <a
            v-if="workstream.issue != null"
            :href="routeHref({ name: 'issue', key: workstream.issue.key }, rangeSelection)"
            class="mt-2 inline-block text-sm font-semibold text-accent hover:underline"
          >
            関連 Issue {{ workstream.issue.repository }}#{{ workstream.issue.number }} を見る
          </a>
        </div>
        <div class="text-right">
          <p class="text-xs text-muted">
            重要度
          </p>
          <p class="font-display text-3xl font-semibold text-accent-dark">
            {{ formatScore(workstream.importance) }}
          </p>
        </div>
      </div>

      <div class="mt-7">
        <h3 class="mb-3 font-semibold">
          ポイント内訳
        </h3>
        <ScoreBreakdownBar
          :breakdown="{
            type: 'workstream',
            implementationPoints: workstream.implementationPoints,
            reviewPoints: workstream.reviewPoints,
            issuePoints: workstream.issuePoints,
            unallocatedPoints: workstream.unallocatedPoints,
          }"
          density="comfortable"
          :maximum-points="
            workstream.implementationPoints +
              workstream.reviewPoints +
              workstream.issuePoints +
              workstream.unallocatedPoints
          "
        />
      </div>

      <div class="mt-6 rounded-xl bg-paper/70 p-4 text-sm leading-6 text-muted">
        <p>
          <span class="font-semibold text-ink">通常編集量</span>
          {{ formatAmount(workstream.uncompressedEditAmount) }}
        </p>
        <p>
          <span class="font-semibold text-ink">圧縮後編集量 U</span>
          {{ formatAmount(workstream.editAmount) }}
        </p>
        <p>
          <span class="font-semibold text-ink">生成物寄与 G</span>
          {{ formatAmount(workstream.generatedContribution) }}、{{ workstream.generatedFileCount }} 件
        </p>
        <p>
          <span class="font-semibold text-ink">未測定</span>
          {{ workstream.unmeasuredFileCount }} 件
          <span v-if="workstream.unmeasuredFileCount > 0">
            {{ unmeasuredReasonsLabel(workstream.unmeasuredReasons) }}
          </span>
        </p>
      </div>

      <h3 class="mt-7 font-semibold">
        この期間の配点
      </h3>
      <ul class="mt-3 space-y-2">
        <li
          v-for="allocation in workstream.allocations"
          :key="allocation.id"
          class="grid gap-2 rounded-xl bg-paper/60 p-3 sm:grid-cols-[7rem_minmax(0,1fr)_6rem]"
        >
          <span
            class="h-fit w-fit rounded-full px-2.5 py-1 text-xs font-semibold"
            :class="kindClass(allocation.kind)"
          >
            {{ contributionKindLabel(allocation.kind) }}
          </span>
          <div>
            <a
              :href="routeHref({ name: 'person', login: allocation.actor.login }, rangeSelection)"
              class="font-semibold hover:text-accent"
            >
              {{ allocation.actor.login }}
            </a>
            <p class="mt-1 text-xs text-muted">
              {{ allocation.reason }}
            </p>
          </div>
          <p class="text-right font-mono font-semibold text-accent-dark">
            +{{ formatScore(allocation.points) }}
          </p>
        </li>
      </ul>
    </section>

    <details class="mt-8 rounded-3xl border border-line bg-surface p-6 sm:p-8">
      <summary class="cursor-pointer list-none font-display text-xl font-semibold">
        変更ファイル {{ pull.files.length }} 件
        <span class="ml-2 text-muted">⌄</span>
      </summary>
      <div class="mt-5 overflow-x-auto">
        <table class="w-full min-w-[38rem] text-left text-sm">
          <thead class="border-b border-line text-xs text-muted">
            <tr>
              <th class="px-3 py-2 font-semibold">
                ファイル
              </th>
              <th class="px-3 py-2 text-right font-semibold">
                追加
              </th>
              <th class="px-3 py-2 text-right font-semibold">
                削除
              </th>
              <th class="px-3 py-2 text-right font-semibold">
                分析
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="file in pull.files"
              :key="file.filename"
              class="border-b border-line/70 last:border-b-0"
            >
              <td class="px-3 py-2 font-mono text-xs">
                {{ file.filename }}
              </td>
              <td class="px-3 py-2 text-right font-mono text-xs">
                +{{ file.additions }}
              </td>
              <td class="px-3 py-2 text-right font-mono text-xs">
                -{{ file.deletions }}
              </td>
              <td class="px-3 py-2 text-right font-mono text-xs">
                {{ fileAnalysisLabel(file) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </main>
</template>
