<script setup lang="ts">
import { computed } from "vue";
import { UnreachableError } from "../domain/errors.ts";
import type { ContributionKind, LeaderboardResult } from "../domain/model.ts";
import {
  contributionKindLabel,
  contributionKinds,
} from "../domain/scoring.ts";
import type { RangeSelection } from "../services/calculationScope.ts";
import {
  createSankeyDiagramLayout,
  type SankeyDiagramLink,
  type SankeyDiagramNode,
  type SankeyDiagramSelection,
} from "../services/sankeyDiagram.ts";

const props = defineProps<{
  selection: SankeyDiagramSelection;
  result: LeaderboardResult;
  rangeSelection: RangeSelection;
}>();

const layout = computed(() =>
  createSankeyDiagramLayout(
    props.result,
    props.selection,
    props.rangeSelection,
  ),
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
    return "var(--color-accent-soft)";
  }
  if (node.role === "pull") {
    return "var(--color-flow-pull)";
  }
  if (node.role === "issue") {
    return "var(--color-flow-issue)";
  }
  if (node.role === "actor" && node.selected) {
    return "var(--color-flow-selected-actor)";
  }
  return "var(--color-flow-neutral)";
}

function nodeStroke(node: SankeyDiagramNode): string {
  if (node.selected) {
    return "var(--color-flow-selected-border)";
  }
  return "var(--color-flow-border)";
}

function nodeTextFill(node: SankeyDiagramNode): string {
  return node.role === "actor" && node.selected
    ? "var(--color-flow-selected-actor-ink)"
    : "var(--color-ink)";
}

function linkColor(link: SankeyDiagramLink): string {
  switch (link.kind) {
    case "implementation":
      return "var(--color-flow-implementation)";
    case "review":
      return "var(--color-kind-review)";
    case "issue":
      return "var(--color-kind-issue)";
  }
}

function linkOpacity(selected: boolean): number {
  if (selected) {
    return 0.7;
  }
  return 0.32;
}

function legendClass(kind: ContributionKind): string {
  switch (kind) {
    case "implementation":
      return "bg-kind-implementation";
    case "review":
      return "bg-kind-review";
    case "issue":
      return "bg-kind-issue";
    default:
      throw new UnreachableError(kind);
  }
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
      <div class="rounded-xl bg-flow-stat-surface px-4 py-3">
        <dt class="text-xs font-semibold text-flow-stat-ink">
          図内の人物への総配点
        </dt>
        <dd class="mt-1 font-mono text-lg font-semibold text-flow-stat-value">
          {{ formatScore(layout.totalAllocatedPoints) }} 点
        </dd>
      </div>
    </dl>

    <div class="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
      <span>発生源 {{ layout.originCount }} 件</span>
      <span>配点明細 {{ layout.allocationCount }} 件</span>
      <span>配点先 {{ layout.contributorCount }} 人</span>
      <span
        v-for="kind in contributionKinds"
        :key="kind"
        class="inline-flex items-center gap-1.5"
      >
        <span
          class="h-1.5 w-7"
          :class="legendClass(kind)"
        />
        {{ contributionKindLabel(kind) }}
      </span>
      <span>選択対象に関係する経路は濃く表示</span>
    </div>

    <div class="mt-4 overflow-x-auto overflow-y-hidden rounded-xl border border-line bg-flow-canvas">
      <svg
        class="block"
        :width="layout.width"
        :height="layout.height"
        :viewBox="`0 0 ${layout.width} ${layout.height}`"
        role="img"
        :aria-label="selectionLabel + ' に関係する PR と Issue から人物への配点経路を示すサンキーダイアグラム'"
      >
        <g>
          <template
            v-for="group in layout.linkGroups"
            :key="group.id"
          >
            <g
              :opacity="linkOpacity(group.selected)"
            >
              <path
                v-for="link in group.links"
                :key="link.id"
                :d="link.path"
                :fill="linkColor(link)"
              />
            </g>
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
