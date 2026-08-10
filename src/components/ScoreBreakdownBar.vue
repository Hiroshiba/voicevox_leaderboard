<script setup lang="ts">
import { computed } from "vue";
import { UnreachableError } from "../domain/errors.ts";
import type { ContributionKind } from "../domain/model.ts";
import {
  contributionKindLabel,
  contributionKinds,
} from "../domain/scoring.ts";
import { calculateScoreBarPercentage } from "../services/scoreBreakdown.ts";

type ScoreBreakdown =
  | {
      type: "allocated";
      implementationPoints: number;
      reviewPoints: number;
      issuePoints: number;
    }
  | {
      type: "workstream";
      implementationPoints: number;
      reviewPoints: number;
      issuePoints: number;
      unallocatedPoints: number;
    };

type BreakdownKind = ContributionKind | "unallocated";

interface BreakdownSegment {
  kind: BreakdownKind;
  label: string;
  points: number;
}

const props = defineProps<{
  breakdown: ScoreBreakdown;
  density: "compact" | "comfortable";
  maximumPoints: number;
}>();

const segments = computed<BreakdownSegment[]>(() => {
  const allocated: BreakdownSegment[] = contributionKinds.map((kind) => ({
    kind,
    label: contributionKindLabel(kind),
    points: pointsForKind(kind),
  }));
  const unallocated: BreakdownSegment = {
    kind: "unallocated",
    label: "配点対象外",
    points:
      props.breakdown.type === "workstream"
        ? props.breakdown.unallocatedPoints
        : 0,
  };
  const result =
    props.breakdown.type === "workstream"
      ? [...allocated, unallocated]
      : allocated;
  for (const segment of result) {
    if (Number.isFinite(segment.points) === false || segment.points < 0) {
      throw new Error(segment.label + "の点数が不正です。");
    }
  }
  if (sum(result.map((segment) => segment.points)) <= 0) {
    throw new Error("点数内訳の合計が正の値ではありません。");
  }
  return result;
});

const totalPoints = computed(() =>
  sum(segments.value.map((segment) => segment.points)),
);
const chartWidth = computed(
  () =>
    calculateScoreBarPercentage(
      totalPoints.value,
      props.maximumPoints,
    ).toString() + "%",
);

const chartLabel = computed(() =>
  segments.value
    .map(
      (segment) => segment.label + " " + formatScore(segment.points) + " 点",
    )
    .join("、"),
);

function pointsForKind(kind: ContributionKind): number {
  switch (kind) {
    case "implementation":
      return props.breakdown.implementationPoints;
    case "review":
      return props.breakdown.reviewPoints;
    case "issue":
      return props.breakdown.issuePoints;
    default:
      throw new UnreachableError(kind);
  }
}

function segmentClass(kind: BreakdownKind): string {
  switch (kind) {
    case "implementation":
      return "bg-emerald-600";
    case "review":
      return "bg-blue-600";
    case "issue":
      return "bg-amber-600";
    case "unallocated":
      return "bg-rose-500";
    default:
      throw new UnreachableError(kind);
  }
}

function formatScore(score: number): string {
  return score.toFixed(2);
}

function formatPercentage(points: number): string {
  return ((points / totalPoints.value) * 100).toFixed(1) + "%";
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
</script>

<template>
  <div>
    <div
      class="w-full overflow-hidden rounded-full bg-line/60"
      :class="density === 'compact' ? 'h-2.5' : 'h-4'"
      role="img"
      :aria-label="chartLabel"
    >
      <div
        class="flex h-full overflow-hidden rounded-full"
        :style="{ width: chartWidth }"
      >
        <div
          v-for="segment in segments"
          v-show="segment.points > 0"
          :key="segment.kind"
          class="min-w-0 basis-0"
          :class="segmentClass(segment.kind)"
          :style="{ flexGrow: segment.points }"
          :title="segment.label + ' ' + formatScore(segment.points) + ' 点 ' + formatPercentage(segment.points)"
        />
      </div>
    </div>
    <dl
      class="flex flex-wrap gap-x-4 gap-y-1.5 text-muted"
      :class="density === 'compact' ? 'mt-2 text-[0.68rem]' : 'mt-3 text-xs'"
    >
      <div
        v-for="segment in segments"
        :key="segment.kind"
        class="flex items-center gap-1.5"
      >
        <dt class="flex items-center gap-1.5">
          <span
            class="size-2 rounded-full"
            :class="segmentClass(segment.kind)"
          />
          {{ segment.label }}
        </dt>
        <dd class="font-mono text-ink">
          {{ formatScore(segment.points) }}
        </dd>
      </div>
    </dl>
  </div>
</template>
