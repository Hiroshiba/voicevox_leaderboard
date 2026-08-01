<script setup lang="ts">
import type {
  ContributionKind,
  DateRange,
  PreparedPull,
  WorkstreamScore,
} from "../domain/model.ts";
import { contributionKindLabel } from "../domain/scoring.ts";
import { routeHref } from "../services/routes.ts";

defineProps<{
  pull: PreparedPull;
  workstream?: WorkstreamScore | undefined;
  range: DateRange;
}>();

function formatScore(score: number): string {
  return score.toFixed(2);
}

function formatLines(lines: number): string {
  return new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits: 1,
  }).format(lines);
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
      return "bg-emerald-100 text-emerald-800";
    case "review":
      return "bg-blue-100 text-blue-800";
    case "issue":
      return "bg-amber-100 text-amber-900";
  }
}
</script>

<template>
  <main class="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
    <a
      :href="routeHref({ name: 'home' }, range)"
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
          :href="routeHref({ name: 'person', login: pull.author.login }, range)"
          class="flex items-center gap-2 font-semibold text-ink hover:text-accent"
        >
          <img
            :src="pull.author.avatarUrl"
            :alt="pull.author.login + ' のアバター'"
            class="size-7 rounded-full border border-line"
          >
          {{ pull.author.login }}
        </a>
        <span>{{ formatDate(pull.mergedAt) }} にマージ</span>
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
            有効変更行 E
          </dt>
          <dd class="mt-1 font-mono text-lg">
            {{ formatLines(pull.effectiveLines) }}
          </dd>
        </div>
        <div class="rounded-xl bg-paper/70 p-4">
          <dt class="text-xs text-muted">
            非生成ファイル F
          </dt>
          <dd class="mt-1 font-mono text-lg">
            {{ pull.nonGeneratedFiles }}
          </dd>
        </div>
        <div class="rounded-xl bg-paper/70 p-4">
          <dt class="text-xs text-muted">
            実装質量 M
          </dt>
          <dd class="mt-1 font-mono text-lg">
            {{ formatScore(pull.mass) }}
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
    </article>

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
            :href="routeHref({ name: 'issue', key: workstream.issue.key }, range)"
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

      <h3 class="mt-7 font-semibold">
        この期間の配点
      </h3>
      <ul class="mt-3 space-y-2">
        <li
          v-for="allocation in workstream.allocations"
          :key="allocation.actor.login + ':' + allocation.kind + ':' + allocation.reason"
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
              :href="routeHref({ name: 'person', login: allocation.actor.login }, range)"
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
                有効行
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
                <span
                  v-if="file.generated"
                  class="ml-2 text-muted"
                >生成物扱い</span>
              </td>
              <td class="px-3 py-2 text-right font-mono text-xs">
                +{{ file.additions }}
              </td>
              <td class="px-3 py-2 text-right font-mono text-xs">
                -{{ file.deletions }}
              </td>
              <td class="px-3 py-2 text-right font-mono text-xs">
                {{ formatLines(file.effectiveLines) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </main>
</template>
