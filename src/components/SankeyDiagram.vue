<script setup lang="ts">
import { computed } from "vue";
import { assertNonNullable } from "../domain/errors.ts";
import type {
  ContributionKind,
  ContributorScore,
  DateRange,
  SourceReference,
} from "../domain/model.ts";
import { contributionKindLabel } from "../domain/scoring.ts";
import { sourceHref } from "../services/routes.ts";

interface SourceFlow {
  id: string;
  source: SourceReference;
  title: string;
  total: number;
  kindPoints: Map<ContributionKind, number>;
}

interface DiagramNode {
  id: string;
  label: string;
  description: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  href?: string | undefined;
}

interface DiagramLink {
  id: string;
  path: string;
  width: number;
  color: string;
  label: string;
  href?: string | undefined;
}

interface DiagramLayout {
  height: number;
  links: DiagramLink[];
  nodes: DiagramNode[];
}

const props = defineProps<{
  contributor: ContributorScore;
  range: DateRange;
}>();

const kindOrder: ContributionKind[] = [
  "implementation",
  "review",
  "issue",
];

const layout = computed<DiagramLayout>(() => createLayout());

function createLayout(): DiagramLayout {
  const sources = collectSources();
  const activeKinds = kindOrder.filter(
    (kind) => kindTotal(kind) > 0,
  );
  const total = props.contributor.score;
  if (total <= 0) {
    throw new Error("サンキーダイアグラムの合計点が正の値ではありません。");
  }
  const height = Math.max(420, sources.length * 48 + 80);
  const sourceGap = 14;
  const kindGap = 28;
  const sourceCapacity =
    height - 80 - sourceGap * Math.max(0, sources.length - 1);
  const kindCapacity =
    height - 80 - kindGap * Math.max(0, activeKinds.length - 1);
  const scale = Math.min(sourceCapacity / total, kindCapacity / total);
  if (scale <= 0) {
    throw new Error("サンキーダイアグラムの描画領域が不足しています。");
  }

  const nodes: DiagramNode[] = [];
  const links: DiagramLink[] = [];
  const personHeight = total * scale;
  const personY = (height - personHeight) / 2;
  nodes.push({
    id: "person",
    label: props.contributor.login,
    description: props.contributor.login,
    x: 20,
    y: personY,
    width: 150,
    height: personHeight,
    color: "#0d5a40",
  });

  const kindNodes = new Map<ContributionKind, DiagramNode>();
  const kindTotalHeight =
    total * scale + kindGap * Math.max(0, activeKinds.length - 1);
  let kindY = (height - kindTotalHeight) / 2;
  for (const kind of activeKinds) {
    const points = kindTotal(kind);
    const node: DiagramNode = {
      id: "kind:" + kind,
      label: contributionKindLabel(kind),
      description: contributionKindLabel(kind),
      x: 410,
      y: kindY,
      width: 140,
      height: points * scale,
      color: kindColor(kind),
    };
    nodes.push(node);
    kindNodes.set(kind, node);
    kindY += node.height + kindGap;
  }

  const sourceTotalHeight =
    total * scale + sourceGap * Math.max(0, sources.length - 1);
  let sourceY = (height - sourceTotalHeight) / 2;
  const sourceNodes = new Map<string, DiagramNode>();
  for (const source of sources) {
    const node: DiagramNode = {
      id: "source:" + source.id,
      label: compactSourceLabel(source.source),
      description: source.title,
      x: 810,
      y: sourceY,
      width: 170,
      height: source.total * scale,
      color: "#f4f1e8",
      href: sourceHref(source.source, props.range),
    };
    nodes.push(node);
    sourceNodes.set(source.id, node);
    sourceY += node.height + sourceGap;
  }

  let personOffset = 0;
  for (const kind of activeKinds) {
    const kindNode = kindNodes.get(kind);
    assertNonNullable(kindNode, "貢献種別ノードがありません。");
    const points = kindTotal(kind);
    const width = points * scale;
    links.push({
      id: "person:" + kind,
      path: createPath(
        170,
        personY + personOffset + width / 2,
        410,
        kindNode.y + kindNode.height / 2,
      ),
      width,
      color: kindColor(kind),
      label:
        props.contributor.login +
        " から " +
        contributionKindLabel(kind) +
        " へ " +
        formatScore(points) +
        " 点",
    });
    personOffset += width;
  }

  const kindOffsets = new Map<ContributionKind, number>();
  const sourceOffsets = new Map<string, number>();
  for (const source of sources) {
    const sourceNode = sourceNodes.get(source.id);
    assertNonNullable(sourceNode, "発生源ノードがありません。");
    for (const kind of activeKinds) {
      const points = source.kindPoints.get(kind) ?? 0;
      if (points === 0) {
        continue;
      }
      const kindNode = kindNodes.get(kind);
      assertNonNullable(kindNode, "貢献種別ノードがありません。");
      const width = points * scale;
      const kindOffset = kindOffsets.get(kind) ?? 0;
      const sourceOffset = sourceOffsets.get(source.id) ?? 0;
      links.push({
        id: kind + ":" + source.id,
        path: createPath(
          550,
          kindNode.y + kindOffset + width / 2,
          810,
          sourceNode.y + sourceOffset + width / 2,
        ),
        width,
        color: kindColor(kind),
        label:
          contributionKindLabel(kind) +
          " から " +
          source.title +
          " へ " +
          formatScore(points) +
          " 点",
        href: sourceHref(source.source, props.range),
      });
      kindOffsets.set(kind, kindOffset + width);
      sourceOffsets.set(source.id, sourceOffset + width);
    }
  }
  return { height, links, nodes };
}

function collectSources(): SourceFlow[] {
  const sources = new Map<string, SourceFlow>();
  for (const entry of props.contributor.entries) {
    const id = entry.source.type + ":" + entry.source.key;
    const current = sources.get(id);
    if (current == null) {
      sources.set(id, {
        id,
        source: entry.source,
        title: entry.sourceTitle,
        total: entry.points,
        kindPoints: new Map([[entry.kind, entry.points]]),
      });
      continue;
    }
    current.total += entry.points;
    current.kindPoints.set(
      entry.kind,
      (current.kindPoints.get(entry.kind) ?? 0) + entry.points,
    );
  }
  return [...sources.values()].sort(
    (left, right) =>
      right.total - left.total || left.id.localeCompare(right.id),
  );
}

function kindTotal(kind: ContributionKind): number {
  switch (kind) {
    case "implementation":
      return props.contributor.implementationPoints;
    case "review":
      return props.contributor.reviewPoints;
    case "issue":
      return props.contributor.issuePoints;
  }
}

function kindColor(kind: ContributionKind): string {
  switch (kind) {
    case "implementation":
      return "#16815d";
    case "review":
      return "#3974b8";
    case "issue":
      return "#d2932c";
  }
}

function createPath(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): string {
  const middleX = (startX + endX) / 2;
  return (
    "M " +
    startX +
    " " +
    startY +
    " C " +
    middleX +
    " " +
    startY +
    ", " +
    middleX +
    " " +
    endY +
    ", " +
    endX +
    " " +
    endY
  );
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : value.slice(0, length - 1) + "…";
}

function compactSourceLabel(source: SourceReference): string {
  const match = /^[^/]+\/([^#]+)#([1-9]\d*)$/.exec(source.key);
  const repository = match?.[1];
  const number = match?.[2];
  assertNonNullable(repository, "発生源キーにリポジトリ名がありません。");
  assertNonNullable(number, "発生源キーに番号がありません。");
  return truncate(repository, 17) + "#" + number;
}

function formatScore(score: number): string {
  return score.toFixed(2);
}
</script>

<template>
  <div class="overflow-x-auto rounded-2xl border border-line bg-surface p-3 sm:p-5">
    <svg
      class="min-w-[52rem]"
      :viewBox="`0 0 1000 ${layout.height}`"
      role="img"
      :aria-label="contributor.login + ' の点数が貢献種別を経て発生源へ流れるサンキーダイアグラム'"
    >
      <g
        fill="none"
        stroke-linecap="butt"
        opacity="0.44"
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
              :stroke="link.color"
              :stroke-width="link.width"
            >
              <title>{{ link.label }}</title>
            </path>
          </a>
          <path
            v-else
            :d="link.path"
            :stroke="link.color"
            :stroke-width="link.width"
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
            :fill="node.color"
            stroke="#d7ddd4"
            rx="5"
          >
            <title>{{ node.description }}</title>
          </rect>
          <text
            :x="node.x + 10"
            :y="node.y + node.height / 2"
            dominant-baseline="middle"
            class="fill-ink text-[12px] font-semibold"
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
            :fill="node.color"
            rx="5"
          />
          <text
            :x="node.x + node.width / 2"
            :y="node.y + node.height / 2"
            dominant-baseline="middle"
            text-anchor="middle"
            class="fill-white text-[13px] font-semibold"
          >
            {{ node.label }}
          </text>
        </g>
      </template>
    </svg>
  </div>
</template>
