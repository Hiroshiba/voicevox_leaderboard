<script setup lang="ts">
import { computed } from "vue";
import { UnreachableError } from "../domain/errors.ts";
import type { LeaderboardResult } from "../domain/model.ts";
import {
  createSankeyDiagramLayout,
  type SankeyDiagramLink,
  type SankeyDiagramNode,
  type SankeyDiagramSelection,
} from "../services/sankeyDiagram.ts";

const props = defineProps<{
  selection: SankeyDiagramSelection;
  result: LeaderboardResult;
}>();

const layout = computed(() =>
  createSankeyDiagramLayout(props.result, props.selection),
);

const selectionLabel = computed((): string => {
  switch (props.selection.type) {
    case "contributor":
      return props.selection.contributor.login;
    case "pull":
      return props.selection.key;
    case "issue":
      return props.selection.key;
    default:
      throw new UnreachableError(props.selection);
  }
});

const highlightedPointsLabel = computed((): string => {
  switch (props.selection.type) {
    case "contributor":
      return props.selection.contributor.login + " への最終配点";
    case "pull":
      return "この PR に関係する人物配点";
    case "issue":
      return "この Issue に関係する人物配点";
    default:
      throw new UnreachableError(props.selection);
  }
});

function nodeFill(node: SankeyDiagramNode): string {
  if (node.selected && node.role !== "actor") {
    return "#dff3e9";
  }
  if (node.role === "pull") {
    return "#f4f1e8";
  }
  if (node.role === "issue") {
    return "#fff5d6";
  }
  if (node.role === "actor" && node.selected) {
    return "#0d5a40";
  }
  return "#e8eef1";
}

function nodeStroke(node: SankeyDiagramNode): string {
  if (node.selected) {
    return "#16815d";
  }
  return "#b9c5c8";
}

function nodeTextFill(node: SankeyDiagramNode): string {
  return node.role === "actor" && node.selected ? "#ffffff" : "#162521";
}

function linkColor(link: SankeyDiagramLink): string {
  switch (link.kind) {
    case "implementation":
      return "#16815d";
    case "review":
      return "#2563eb";
    case "issue":
      return "#d97706";
  }
}

function linkOpacity(link: SankeyDiagramLink): number {
  if (link.selected) {
    return 0.7;
  }
  return 0.32;
}

function formatScore(score: number): string {
  return score.toFixed(2);
}
</script>

<template>
  <div class="rounded-2xl border border-line bg-surface p-3 sm:p-5">
    <dl class="grid gap-3 sm:grid-cols-2">
      <div class="rounded-xl bg-accent-soft px-4 py-3">
        <dt class="text-xs font-semibold text-accent-dark">
          {{ highlightedPointsLabel }}
        </dt>
        <dd class="mt-1 font-mono text-lg font-semibold text-accent-dark">
          {{ formatScore(layout.highlightedPoints) }} 点
        </dd>
      </div>
      <div class="rounded-xl bg-slate-100 px-4 py-3">
        <dt class="text-xs font-semibold text-slate-600">
          図内の人物への総配点
        </dt>
        <dd class="mt-1 font-mono text-lg font-semibold text-slate-700">
          {{ formatScore(layout.totalAllocatedPoints) }} 点
        </dd>
      </div>
    </dl>

    <div class="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
      <span>発生源 {{ layout.originCount }} 件</span>
      <span>配点明細 {{ layout.allocationCount }} 件</span>
      <span>配点先 {{ layout.contributorCount }} 人</span>
      <span class="inline-flex items-center gap-1.5">
        <span class="h-1.5 w-7 bg-emerald-600" />
        実装
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span class="h-1.5 w-7 bg-blue-600" />
        レビュー
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span class="h-1.5 w-7 bg-amber-600" />
        Issue・調査
      </span>
      <span>選択対象に関係する経路は濃く表示</span>
    </div>

    <div class="mt-4 overflow-x-auto rounded-xl border border-line bg-white">
      <svg
        class="block"
        :width="layout.width"
        :height="layout.height"
        :viewBox="`0 0 ${layout.width} ${layout.height}`"
        role="img"
        :aria-label="selectionLabel + ' に関係する PR と Issue から人物への配点経路を示すサンキーダイアグラム'"
      >
        <g
          fill="none"
          stroke-linecap="butt"
        >
          <template
            v-for="link in layout.links"
            :key="link.id"
          >
            <a
              :href="link.href"
            >
              <path
                :d="link.path"
                :stroke="linkColor(link)"
                :stroke-width="link.width"
                :opacity="linkOpacity(link)"
              >
                <title>{{ link.label }}</title>
              </path>
            </a>
          </template>
        </g>

        <template
          v-for="node in layout.nodes"
          :key="node.id"
        >
          <a
            :href="node.href"
          >
            <rect
              :x="node.x"
              :y="node.y"
              :width="node.width"
              :height="node.height"
              :fill="nodeFill(node)"
              :stroke="nodeStroke(node)"
              rx="5"
            >
              <title>{{ node.description }}</title>
            </rect>
            <text
              :x="node.x + 11"
              :y="node.y + node.height / 2"
              :fill="nodeTextFill(node)"
              dominant-baseline="middle"
              class="text-[12px] font-semibold"
            >
              {{ node.label }}
            </text>
          </a>
        </template>
      </svg>
    </div>
  </div>
</template>
