<script setup lang="ts">
import { computed } from "vue";
import { UnreachableError } from "../domain/errors.ts";
import type {
  DateRange,
  EvidenceKind,
  LeaderboardResult,
  PreparedIssue,
  StandaloneIssueScore,
  WorkstreamScore,
} from "../domain/model.ts";
import { contributionKindLabel } from "../domain/scoring.ts";
import type { RangeSelection } from "../services/calculationScope.ts";
import { routeHref } from "../services/routes.ts";
import type { SankeyDiagramSelection } from "../services/sankeyDiagram.ts";
import SankeyDiagram from "./SankeyDiagram.vue";
import ScoreBreakdownBar from "./ScoreBreakdownBar.vue";

const props = defineProps<{
  issue: PreparedIssue;
  workstreams: WorkstreamScore[];
  standalone?: StandaloneIssueScore | undefined;
  range: DateRange;
  result: LeaderboardResult;
  rangeSelection: RangeSelection;
}>();

const sankeySelection = computed<SankeyDiagramSelection>(() => ({
  type: "issue",
  key: props.issue.key,
}));
const hasSankeyData = computed(
  () =>
    props.standalone != null ||
    props.workstreams.some(
      (workstream) => workstream.allocations.length > 0,
    ),
);

const commentsInRange = computed(() =>
  props.issue.comments.filter((comment) => {
    const date = comment.createdAt.slice(0, 10);
    return date >= props.range.start && date <= props.range.end;
  }),
);

const substantiveCommentsInRange = computed(() =>
  commentsInRange.value.filter((comment) => comment.substantive),
);

function formatScore(score: number): string {
  return score.toFixed(2);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function evidenceLabel(kind: EvidenceKind): string {
  switch (kind) {
    case "codeOrLog":
      return "コード・ログ";
    case "command":
      return "コマンド";
    case "attachment":
      return "添付";
    case "reference":
      return "外部参照";
    case "environment":
      return "実行環境";
    case "measurement":
      return "測定値";
    default:
      throw new UnreachableError(kind);
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
        Issue
      </p>
      <div class="mt-3 flex flex-wrap items-center gap-3">
        <p class="text-sm font-semibold text-muted">
          {{ issue.repository }}#{{ issue.number }}
        </p>
        <span
          class="rounded-full px-2.5 py-1 text-xs font-semibold"
          :class="issue.state === 'open' ? 'bg-accent-soft text-accent-dark' : 'bg-line text-muted'"
        >
          {{ issue.state === "open" ? "Open" : "Closed" }}
        </span>
      </div>
      <h1 class="mt-2 max-w-4xl font-display text-3xl leading-tight font-semibold">
        {{ issue.title }}
      </h1>
      <div class="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
        <template v-if="issue.author != null">
          <a
            v-if="issue.authorIsHuman"
            :href="routeHref({ name: 'person', login: issue.author.login }, rangeSelection)"
            class="flex items-center gap-2 font-semibold text-ink hover:text-accent"
          >
            <img
              :src="issue.author.avatarUrl"
              :alt="issue.author.login + ' のアバター'"
              class="size-7 rounded-full border border-line"
            >
            {{ issue.author.login }}
          </a>
          <span v-else>{{ issue.author.login }}</span>
        </template>
        <span>{{ formatDate(issue.createdAt) }} に作成</span>
        <span v-if="issue.closedAt != null">{{ formatDate(issue.closedAt) }} に Close</span>
        <a
          :href="issue.githubUrl"
          target="_blank"
          rel="noreferrer"
          class="font-semibold text-accent hover:underline"
        >
          GitHub で Issue を開く ↗
        </a>
      </div>

      <dl class="mt-7 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div class="rounded-xl bg-paper/70 p-4">
          <dt class="text-xs text-muted">
            期間内コメント
          </dt>
          <dd class="mt-1 font-mono text-lg">
            {{ commentsInRange.length }}
          </dd>
        </div>
        <div class="rounded-xl bg-paper/70 p-4">
          <dt class="text-xs text-muted">
            実質的コメント
          </dt>
          <dd class="mt-1 font-mono text-lg">
            {{ substantiveCommentsInRange.length }}
          </dd>
        </div>
        <div class="rounded-xl bg-paper/70 p-4">
          <dt class="text-xs text-muted">
            本文の証拠要素
          </dt>
          <dd class="mt-1 font-mono text-lg">
            {{ issue.bodyEvidenceKinds.length }}
          </dd>
        </div>
        <div class="rounded-xl bg-paper/70 p-4">
          <dt class="text-xs text-muted">
            状態理由
          </dt>
          <dd class="mt-1 text-sm">
            {{ issue.stateReason ?? "記録なし" }}
          </dd>
        </div>
      </dl>

      <div
        v-if="issue.bodyEvidenceKinds.length > 0"
        class="mt-5 flex flex-wrap gap-2"
      >
        <span
          v-for="kind in issue.bodyEvidenceKinds"
          :key="kind"
          class="rounded-full border border-line bg-white px-2.5 py-1 text-xs text-muted"
        >
          {{ evidenceLabel(kind) }}
        </span>
      </div>
    </article>

    <section
      class="mt-10"
      aria-labelledby="issue-sankey-heading"
    >
      <p class="mb-1 text-xs font-semibold tracking-[0.18em] text-accent uppercase">
        Score flow
      </p>
      <h2
        id="issue-sankey-heading"
        class="font-display text-2xl font-semibold"
      >
        この Issue からのポイント経路
      </h2>
      <p class="mt-2 mb-5 max-w-3xl text-sm leading-7 text-muted">
        関連 PR がある場合は PR から Issue と人物への経路を表示します。
        PR にならなかった Issue は Issue から人物への経路を表示します。
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
          選択期間にはこの Issue からの配点がありません
        </p>
        <p class="mt-2 text-sm text-muted">
          Issue の活動を含む期間へ変更すると経路を表示できる場合があります。
        </p>
      </div>
    </section>

    <section
      v-if="standalone != null"
      class="mt-8 rounded-3xl border border-line bg-surface p-6 sm:p-8"
      aria-labelledby="standalone-heading"
    >
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="text-xs font-semibold tracking-[0.18em] text-accent uppercase">
            Standalone issue score
          </p>
          <h2
            id="standalone-heading"
            class="mt-2 font-display text-2xl font-semibold"
          >
            PR にならなかった Issue の配点
          </h2>
        </div>
        <p class="font-display text-3xl font-semibold text-accent-dark">
          {{ formatScore(standalone.score) }}
        </p>
      </div>
      <p class="mt-3 text-sm text-muted">
        状態 {{ standalone.statusBonus }} ・ 証拠 {{ standalone.evidenceCount }} 種 ・
        実質的コメント {{ standalone.substantiveCommentCount }} 件 ・ 参加者
        {{ standalone.participantCount }} 人
      </p>
      <div class="mt-5">
        <h3 class="mb-3 font-semibold">
          ポイント内訳
        </h3>
        <ScoreBreakdownBar
          :breakdown="{
            type: 'allocated',
            implementationPoints: 0,
            reviewPoints: 0,
            issuePoints: standalone.score,
          }"
          density="comfortable"
          :maximum-points="standalone.score"
        />
      </div>
      <ul class="mt-5 space-y-2">
        <li
          v-for="allocation in standalone.allocations"
          :key="allocation.id"
          class="grid gap-2 rounded-xl bg-paper/60 p-3 sm:grid-cols-[minmax(0,1fr)_6rem]"
        >
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

    <section
      v-for="(workstream, index) in workstreams"
      :key="workstream.key"
      class="mt-8 rounded-3xl border border-line bg-surface p-6 sm:p-8"
      :aria-labelledby="'linked-workstream-heading-' + index"
    >
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="text-xs font-semibold tracking-[0.18em] text-accent uppercase">
            Linked workstream
          </p>
          <h2
            :id="'linked-workstream-heading-' + index"
            class="mt-2 font-display text-2xl font-semibold"
          >
            関連するマージ成果
          </h2>
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

      <ul class="mt-5 space-y-2">
        <li
          v-for="pull in workstream.pulls"
          :key="pull.key"
        >
          <a
            :href="routeHref({ name: 'pull', key: pull.key }, rangeSelection)"
            class="font-semibold hover:text-accent"
          >
            {{ pull.repository }}#{{ pull.number }} {{ pull.title }}
          </a>
        </li>
      </ul>

      <h3 class="mt-7 font-semibold">
        この成果からの配点
      </h3>
      <ul class="mt-3 space-y-2">
        <li
          v-for="allocation in workstream.allocations"
          :key="allocation.id"
          class="grid gap-2 rounded-xl bg-paper/60 p-3 sm:grid-cols-[7rem_minmax(0,1fr)_6rem]"
        >
          <span class="text-xs font-semibold text-muted">
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

    <section
      v-if="standalone == null && workstreams.length === 0"
      class="mt-8 rounded-3xl border border-line bg-surface px-6 py-10 text-center"
    >
      <p class="font-semibold">
        選択期間にはこの Issue からの配点がありません
      </p>
      <p class="mt-2 text-sm text-muted">
        期間を変更すると配点対象になる場合があります。
      </p>
    </section>
  </main>
</template>
