<script setup lang="ts">
import { computed } from "vue";
import type {
  ContributorScore,
  LeaderboardResult,
} from "../domain/model.ts";
import {
  createSankeyDiagramLayout,
  type SankeyDiagramLink,
  type SankeyDiagramNode,
} from "../services/sankeyDiagram.ts";

const props = defineProps<{
  contributor: ContributorScore;
  result: LeaderboardResult;
}>();

const layout = computed(() =>
  createSankeyDiagramLayout(props.result, props.contributor),
);

function nodeFill(node: SankeyDiagramNode): string {
  if (node.role === "source") {
    return "#f4f1e8";
  }
  if (node.unallocated) {
    return "#fde8e3";
  }
  if (node.role === "actor" && node.selected) {
    return "#0d5a40";
  }
  if (node.selected) {
    return "#dff3e9";
  }
  return "#e8eef1";
}

function nodeStroke(node: SankeyDiagramNode): string {
  if (node.unallocated) {
    return "#b33a3a";
  }
  if (node.selected) {
    return "#16815d";
  }
  return "#b9c5c8";
}

function nodeTextFill(node: SankeyDiagramNode): string {
  return node.role === "actor" && node.selected ? "#ffffff" : "#162521";
}

function linkColor(link: SankeyDiagramLink): string {
  if (link.unallocated) {
    return "#c35b4f";
  }
  return link.selected ? "#16815d" : "#78919a";
}

function linkOpacity(link: SankeyDiagramLink): number {
  if (link.selected) {
    return 0.62;
  }
  return link.unallocated ? 0.5 : 0.3;
}

function formatScore(score: number): string {
  return score.toFixed(2);
}
</script>

<template>
  <div class="rounded-2xl border border-line bg-surface p-3 sm:p-5">
    <dl class="grid gap-3 sm:grid-cols-3">
      <div class="rounded-xl bg-accent-soft px-4 py-3">
        <dt class="text-xs font-semibold text-accent-dark">
          {{ contributor.login }} への最終配点
        </dt>
        <dd class="mt-1 font-mono text-lg font-semibold text-accent-dark">
          {{ formatScore(layout.selectedPoints) }} 点
        </dd>
      </div>
      <div class="rounded-xl bg-slate-100 px-4 py-3">
        <dt class="text-xs font-semibold text-slate-600">
          同じ成果から他の人物へ
        </dt>
        <dd class="mt-1 font-mono text-lg font-semibold text-slate-700">
          {{ formatScore(layout.otherContributorPoints) }} 点
        </dd>
      </div>
      <div class="rounded-xl bg-red-50 px-4 py-3">
        <dt class="text-xs font-semibold text-danger">
          誰にも配分されず図外へ流出
        </dt>
        <dd class="mt-1 font-mono text-lg font-semibold text-danger">
          {{ formatScore(layout.unallocatedPoints) }} 点
        </dd>
      </div>
    </dl>

    <div class="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
      <span>成果 {{ layout.sourceCount }} 件</span>
      <span>配点経路 {{ layout.activityCount }} 件</span>
      <span class="inline-flex items-center gap-1.5">
        <span class="h-1.5 w-7 bg-accent" />
        選択中の人物
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span class="h-1.5 w-7 bg-slate-500" />
        他の人物
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span class="h-1.5 w-7 bg-red-500" />
        未配分
      </span>
    </div>

    <div class="mt-4 max-h-[75vh] overflow-auto rounded-xl border border-line bg-white">
      <svg
        class="block"
        :width="layout.width"
        :height="layout.height"
        :viewBox="`0 0 ${layout.width} ${layout.height}`"
        role="img"
        :aria-label="contributor.login + ' に関係する成果から個別活動と人物または図外への全配点経路を示すサンキーダイアグラム'"
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
              v-if="link.href != null"
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
            <path
              v-else
              :d="link.path"
              :stroke="linkColor(link)"
              :stroke-width="link.width"
              :opacity="linkOpacity(link)"
            >
              <title>{{ link.label }}</title>
            </path>
          </template>
        </g>

        <template
          v-for="node in layout.nodes"
          :key="node.id"
        >
          <a
            v-if="node.href != null"
            :href="node.href"
          >
            <rect
              :x="node.x"
              :y="node.y"
              :width="node.width"
              :height="node.height"
              :fill="nodeFill(node)"
              :stroke="nodeStroke(node)"
              :stroke-dasharray="node.unallocated ? '8 5' : undefined"
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
          <g v-else>
            <rect
              :x="node.x"
              :y="node.y"
              :width="node.width"
              :height="node.height"
              :fill="nodeFill(node)"
              :stroke="nodeStroke(node)"
              :stroke-dasharray="node.unallocated ? '8 5' : undefined"
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
          </g>
        </template>
      </svg>
    </div>
  </div>
</template>
