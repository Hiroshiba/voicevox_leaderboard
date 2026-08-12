import { assertNonNullable, UnreachableError } from "../domain/errors.ts";
import type {
  Actor,
  ContributionKind,
  ContributorScore,
  LeaderboardResult,
  ScoreAllocation,
  SourceReference,
  WorkstreamScore,
} from "../domain/model.ts";
import type { RangeSelection } from "./calculationScope.ts";
import { routeHref, sourceHref } from "./routes.ts";

export type SankeyDiagramNodeRole = "pull" | "issue" | "actor";

export type SankeyDiagramSelection =
  | { type: "contributor"; contributor: ContributorScore }
  | { type: "pull"; key: string }
  | { type: "issue"; key: string };

export interface SankeyDiagramNode {
  id: string;
  role: SankeyDiagramNodeRole;
  label: string;
  description: string;
  points: number;
  x: number;
  y: number;
  width: number;
  height: number;
  selected: boolean;
  href: string;
}

export interface SankeyDiagramLink {
  id: string;
  sourceId: string;
  targetId: string;
  kind: ContributionKind;
  points: number;
  path: string;
  width: number;
  label: string;
  selected: boolean;
  href: string;
}

export interface SankeyDiagramLayout {
  width: number;
  height: number;
  nodes: SankeyDiagramNode[];
  links: SankeyDiagramLink[];
  originCount: number;
  allocationCount: number;
  highlightedPoints: number;
  totalAllocatedPoints: number;
  contributorCount: number;
}

interface ReferenceFlowNode {
  id: string;
  role: "pull" | "issue";
  reference: SourceReference;
  title: string;
  selected: boolean;
}

interface ActorFlowNode {
  id: string;
  role: "actor";
  actor: Actor;
  selected: boolean;
}

type FlowNode = ReferenceFlowNode | ActorFlowNode;

interface FlowLink {
  id: string;
  sourceId: string;
  targetId: string;
  kind: ContributionKind;
  points: number;
  label: string;
  selected: boolean;
  href: string;
}

interface FlowGraph {
  nodes: FlowNode[];
  links: FlowLink[];
  allocationCount: number;
}

interface FlowGraphBuilder {
  selection: SankeyDiagramSelection;
  rangeSelection: RangeSelection;
  nodes: Map<string, FlowNode>;
  links: FlowLink[];
  linkIds: Set<string>;
  selectedAllocationIds: string[];
  allocationCount: number;
}

interface NodeLayout {
  flow: FlowNode;
  points: number;
  x: number;
  y: number;
  width: number;
  height: number;
  incomingFlowHeight: number;
  outgoingFlowHeight: number;
}

interface ColumnLayout {
  height: number;
  nodes: NodeLayout[];
}

const diagramWidth = 1160;
const diagramPadding = 32;
const pullX = 20;
const issueX = 450;
const actorX = 880;
const nodeWidth = 260;
const flowScale = 12;
const minimumFlowWidth = 1;
const minimumNodeHeight = 42;
const nodeGap = 16;

/** 選択対象に関係する配点を PR、Issue、人物の経路として配置する。 */
export function createSankeyDiagramLayout(
  result: LeaderboardResult,
  selection: SankeyDiagramSelection,
  rangeSelection: RangeSelection,
): SankeyDiagramLayout {
  const graph = collectFlowGraph(result, selection, rangeSelection);
  if (graph.links.length === 0) {
    throw new Error("選択対象に関係する配点経路がありません。");
  }
  const nodeLayouts = layoutNodes(graph);
  const highlightedPoints = sum(
    graph.links
      .filter(
        (link) => link.targetId.startsWith("actor:") && link.selected,
      )
      .map((link) => link.points),
  );
  const totalAllocatedPoints = sum(
    graph.links
      .filter((link) => link.targetId.startsWith("actor:"))
      .map((link) => link.points),
  );
  if (selection.type === "contributor") {
    assertNearlyEqual(
      selection.contributor.score,
      highlightedPoints,
      "人物の合計点と図内の人物への流入点が一致しません。",
    );
  }
  const targetIds = new Set(graph.links.map((link) => link.targetId));

  return {
    width: diagramWidth,
    height:
      Math.max(...nodeLayouts.map((layout) => layout.y + layout.height)) +
      diagramPadding,
    nodes: createDiagramNodes(rangeSelection, nodeLayouts),
    links: createDiagramLinks(graph.links, nodeLayouts),
    originCount: graph.nodes.filter((node) => targetIds.has(node.id) === false)
      .length,
    allocationCount: graph.allocationCount,
    highlightedPoints,
    totalAllocatedPoints,
    contributorCount: graph.nodes.filter((node) => node.role === "actor")
      .length,
  };
}

function collectFlowGraph(
  result: LeaderboardResult,
  selection: SankeyDiagramSelection,
  rangeSelection: RangeSelection,
): FlowGraph {
  const builder: FlowGraphBuilder = {
    selection,
    rangeSelection,
    nodes: new Map<string, FlowNode>(),
    links: [],
    linkIds: new Set<string>(),
    selectedAllocationIds: [],
    allocationCount: 0,
  };

  for (const workstream of result.workstreams) {
    if (selectionMatchesWorkstream(selection, workstream) === false) {
      continue;
    }
    collectWorkstreamFlows(builder, workstream);
  }
  for (const standalone of result.standaloneIssues) {
    if (
      selectionMatchesStandaloneIssue(
        selection,
        standalone.key,
        standalone.allocations,
      ) === false
    ) {
      continue;
    }
    assertNearlyEqual(
      standalone.score,
      sum(standalone.allocations.map((allocation) => allocation.points)),
      standalone.key + " の総量と配点の合計が一致しません。",
    );
    const issueReference: SourceReference = {
      type: "issue",
      key: standalone.key,
    };
    const issueId = addReferenceNode(
      builder,
      issueReference,
      standalone.title,
    );
    for (const allocation of standalone.allocations) {
      assertAllocationSource(
        allocation,
        "issue",
        standalone.key,
        standalone.key,
      );
      addAllocationLink(
        builder,
        issueId,
        allocation,
        "standalone:" + standalone.key,
        allocationMatchesStandaloneSelection(
          selection,
          standalone.key,
          allocation,
        ),
      );
    }
  }

  if (selection.type === "contributor") {
    const selectedIds = builder.selectedAllocationIds.toSorted();
    const contributorIds = selection.contributor.entries
      .map((entry) => entry.id)
      .toSorted();
    if (
      selectedIds.length !== contributorIds.length ||
      selectedIds.some((id, index) => id !== contributorIds[index])
    ) {
      throw new Error(
        "人物の配点明細とサンキーダイアグラムの経路が一致しません。",
      );
    }
  }

  return {
    nodes: [...builder.nodes.values()],
    links: aggregateFlowLinks(builder.links),
    allocationCount: builder.allocationCount,
  };
}

function collectWorkstreamFlows(
  builder: FlowGraphBuilder,
  workstream: WorkstreamScore,
): void {
  assertWorkstreamConservation(workstream);
  const pullByKey = new Map(
    workstream.pulls.map((pull) => [pull.key.toLowerCase(), pull]),
  );
  if (pullByKey.size !== workstream.pulls.length) {
    throw new Error(workstream.key + " に同じ PR が複数含まれています。");
  }
  const issueAllocations: ScoreAllocation[] = [];

  for (const allocation of workstream.allocations) {
    if (allocation.kind === "issue") {
      const issue = workstream.issue;
      assertNonNullable(
        issue,
        workstream.key + " の Issue 配点に関連 Issue がありません。",
      );
      assertAllocationSource(
        allocation,
        "issue",
        issue.key,
        workstream.key,
      );
      const issueId = addReferenceNode(
        builder,
        allocation.source,
        issue.title,
      );
      addAllocationLink(
        builder,
        issueId,
        allocation,
        "workstream:" + workstream.key,
        allocationMatchesWorkstreamSelection(
          builder.selection,
          workstream,
          allocation,
        ),
      );
      issueAllocations.push(allocation);
      continue;
    }

    if (allocation.source.type !== "pull") {
      throw new Error(
        workstream.key + " の実装・レビュー配点元が PR ではありません。",
      );
    }
    const pull = pullByKey.get(allocation.source.key.toLowerCase());
    assertNonNullable(
      pull,
      workstream.key + " の配点元 PR " + allocation.source.key + " がありません。",
    );
    const pullId = addReferenceNode(builder, allocation.source, pull.title);
    addAllocationLink(
      builder,
      pullId,
      allocation,
      "workstream:" + workstream.key,
      allocationMatchesWorkstreamSelection(
        builder.selection,
        workstream,
        allocation,
      ),
    );
  }

  if (issueAllocations.length === 0) {
    return;
  }
  const issue = workstream.issue;
  assertNonNullable(
    issue,
    workstream.key + " の Issue 配点に関連 Issue がありません。",
  );
  const issueReference: SourceReference = { type: "issue", key: issue.key };
  const issueId = addReferenceNode(builder, issueReference, issue.title);
  const totalMass = sum(workstream.pulls.map((pull) => pull.mass));
  if (totalMass <= 0) {
    throw new Error(workstream.key + " の PR 質量が正の値ではありません。");
  }
  for (const pull of workstream.pulls) {
    if (pull.mass <= 0) {
      throw new Error(pull.key + " の PR 質量が正の値ではありません。");
    }
    const pullReference: SourceReference = { type: "pull", key: pull.key };
    const pullId = addReferenceNode(builder, pullReference, pull.title);
    for (const allocation of issueAllocations) {
      const points = allocation.points * (pull.mass / totalMass);
      const selected = issueInputMatchesSelection(
        builder.selection,
        workstream,
        pull.key,
      );
      addFlowLink(builder, {
        id:
          "issue-input:" +
          workstream.key +
          ":" +
          pull.key +
          ":" +
          allocation.id,
        sourceId: pullId,
        targetId: issueId,
        kind: "issue",
        points,
        label:
          compactReferenceLabel(pullReference) +
          " から " +
          compactReferenceLabel(issueReference) +
          " の Issue 配点へ " +
          formatScore(points) +
          " 点。" +
          allocation.reason,
        selected,
        href: sourceHref(issueReference, builder.rangeSelection),
      });
    }
  }
}

function addAllocationLink(
  builder: FlowGraphBuilder,
  sourceId: string,
  allocation: ScoreAllocation,
  scopeId: string,
  selected: boolean,
): void {
  const actorId = addActorNode(builder, allocation.actor);
  addFlowLink(builder, {
    id: "allocation:" + scopeId + ":" + allocation.id,
    sourceId,
    targetId: actorId,
    kind: allocation.kind,
    points: allocation.points,
    label:
      allocation.sourceTitle +
      " から " +
      allocation.actor.login +
      " へ " +
      formatScore(allocation.points) +
      " 点。" +
      allocation.reason,
    selected,
    href: sourceHref(allocation.source, builder.rangeSelection),
  });
  builder.allocationCount += 1;
  if (builder.selection.type === "contributor" && selected) {
    builder.selectedAllocationIds.push(allocation.id);
  }
}

function addFlowLink(builder: FlowGraphBuilder, link: FlowLink): void {
  if (link.points <= 0) {
    throw new Error(link.id + " の配点が正の値ではありません。");
  }
  if (builder.linkIds.has(link.id)) {
    throw new Error(link.id + " の配点経路が重複しています。");
  }
  builder.linkIds.add(link.id);
  builder.links.push(link);
}

function aggregateFlowLinks(links: FlowLink[]): FlowLink[] {
  const aggregated = new Map<string, FlowLink>();
  for (const link of links) {
    const key = flowLinkKey(link);
    const current = aggregated.get(key);
    if (current == null) {
      aggregated.set(key, {
        ...link,
        id: key,
      });
      continue;
    }
    if (current.selected !== link.selected) {
      throw new Error(key + " の選択状態が一致しません。");
    }
    const points = current.points + link.points;
    aggregated.set(key, {
      ...current,
      points,
      label:
        "同じ始点・終点・配点種別の配点を合計 " +
        formatScore(points) +
        " 点",
    });
  }
  return [...aggregated.values()];
}

function flowLinkKey(link: FlowLink): string {
  return "flow:" + JSON.stringify([link.sourceId, link.targetId, link.kind]);
}

function addReferenceNode(
  builder: FlowGraphBuilder,
  reference: SourceReference,
  title: string,
): string {
  const id = referenceNodeId(reference);
  const current = builder.nodes.get(id);
  if (current != null) {
    if (current.role !== reference.type) {
      throw new Error(id + " のノード種別が一致しません。");
    }
    return id;
  }
  builder.nodes.set(id, {
    id,
    role: reference.type,
    reference,
    title,
    selected: referenceMatchesSelection(builder.selection, reference),
  });
  return id;
}

function addActorNode(
  builder: FlowGraphBuilder,
  actor: Actor,
): string {
  const id = actorNodeId(actor.login);
  const selected = actorMatchesSelection(builder.selection, actor);
  const current = builder.nodes.get(id);
  if (current != null) {
    if (current.role !== "actor") {
      throw new Error(id + " のノード種別が人物ではありません。");
    }
    if (current.selected !== selected) {
      throw new Error(id + " の選択状態が一致しません。");
    }
    return id;
  }
  builder.nodes.set(id, {
    id,
    role: "actor",
    actor,
    selected,
  });
  return id;
}

function layoutNodes(graph: FlowGraph): NodeLayout[] {
  const incomingFlowHeights = sumLinkWidths(graph.links, "incoming");
  const outgoingFlowHeights = sumLinkWidths(graph.links, "outgoing");
  const incomingPoints = sumLinkPoints(graph.links, "incoming");
  const outgoingPoints = sumLinkPoints(graph.links, "outgoing");
  const selectedPoints = sumSelectedLinkPoints(graph.links);
  const layouts = graph.nodes.map((flow): NodeLayout => {
    const incomingFlowHeight = incomingFlowHeights.get(flow.id) ?? 0;
    const outgoingFlowHeight = outgoingFlowHeights.get(flow.id) ?? 0;
    const incoming = incomingPoints.get(flow.id) ?? 0;
    const outgoing = outgoingPoints.get(flow.id) ?? 0;
    if (incoming > 0 && outgoing > 0) {
      assertNearlyEqual(
        incoming,
        outgoing,
        flow.id + " の流入点と流出点が一致しません。",
      );
    }
    return {
      flow,
      points: Math.max(incoming, outgoing),
      x: nodeX(flow.role),
      y: 0,
      width: nodeWidth,
      height: Math.max(
        minimumNodeHeight,
        incomingFlowHeight,
        outgoingFlowHeight,
      ),
      incomingFlowHeight,
      outgoingFlowHeight,
    };
  });
  const columns = [
    layoutColumn(layouts, "pull", selectedPoints),
    layoutColumn(layouts, "issue", selectedPoints),
    layoutColumn(layouts, "actor", selectedPoints),
  ];
  const contentHeight = Math.max(...columns.map((column) => column.height));
  for (const column of columns) {
    const shift = diagramPadding + (contentHeight - column.height) / 2;
    for (const layout of column.nodes) {
      layout.y += shift;
    }
  }
  return layouts;
}

function layoutColumn(
  layouts: NodeLayout[],
  role: SankeyDiagramNodeRole,
  selectedPoints: Map<string, number>,
): ColumnLayout {
  const nodes = layouts
    .filter((layout) => layout.flow.role === role)
    .sort(
      (left, right) =>
        (selectedPoints.get(right.flow.id) ?? 0) -
          (selectedPoints.get(left.flow.id) ?? 0) ||
        right.points - left.points ||
        left.flow.id.localeCompare(right.flow.id),
    );
  let nextY = 0;
  for (const node of nodes) {
    node.y = nextY;
    nextY += node.height + nodeGap;
  }
  return {
    height: Math.max(0, nextY - nodeGap),
    nodes,
  };
}

function createDiagramNodes(
  rangeSelection: RangeSelection,
  layouts: NodeLayout[],
): SankeyDiagramNode[] {
  return layouts.map((layout): SankeyDiagramNode => {
    if (layout.flow.role === "actor") {
      return {
        id: layout.flow.id,
        role: layout.flow.role,
        label:
          layout.flow.actor.login + " " + formatScore(layout.points) + " 点",
        description:
          layout.flow.actor.login +
          " へ図示された経路から " +
          formatScore(layout.points) +
          " 点",
        points: layout.points,
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
        selected: layout.flow.selected,
        href: routeHref(
          { name: "person", login: layout.flow.actor.login },
          rangeSelection,
        ),
      };
    }
    const roleLabel = layout.flow.role === "pull" ? "PR" : "Issue";
    return {
      id: layout.flow.id,
      role: layout.flow.role,
      label:
        compactReferenceLabel(layout.flow.reference) +
        " " +
        truncate(layout.flow.title, 16),
      description:
        roleLabel +
        "「" +
        layout.flow.title +
        "」から図示された配点 " +
        formatScore(layout.points) +
        " 点",
      points: layout.points,
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
      selected: layout.flow.selected,
      href: sourceHref(layout.flow.reference, rangeSelection),
    };
  });
}

function createDiagramLinks(
  flows: FlowLink[],
  nodeLayouts: NodeLayout[],
): SankeyDiagramLink[] {
  const nodeById = new Map(
    nodeLayouts.map((layout) => [layout.flow.id, layout]),
  );
  const outgoingByNode = groupLinks(flows, "outgoing");
  const incomingByNode = groupLinks(flows, "incoming");
  const sourceYByLink = new Map<string, number>();
  const targetYByLink = new Map<string, number>();

  for (const node of nodeLayouts) {
    const outgoing = outgoingByNode.get(node.flow.id) ?? [];
    outgoing.sort((left, right) =>
      compareLinkedNodes(left.targetId, right.targetId, nodeById, left, right),
    );
    let offset = (node.height - node.outgoingFlowHeight) / 2;
    for (const flow of outgoing) {
      const width = scoreWidth(flow.points);
      sourceYByLink.set(flow.id, node.y + offset + width / 2);
      offset += width;
    }

    const incoming = incomingByNode.get(node.flow.id) ?? [];
    incoming.sort((left, right) =>
      compareLinkedNodes(left.sourceId, right.sourceId, nodeById, left, right),
    );
    offset = (node.height - node.incomingFlowHeight) / 2;
    for (const flow of incoming) {
      const width = scoreWidth(flow.points);
      targetYByLink.set(flow.id, node.y + offset + width / 2);
      offset += width;
    }
  }

  return flows
    .map((flow): SankeyDiagramLink => {
      const source = nodeById.get(flow.sourceId);
      const target = nodeById.get(flow.targetId);
      const sourceY = sourceYByLink.get(flow.id);
      const targetY = targetYByLink.get(flow.id);
      assertNonNullable(source, flow.sourceId + " の始点ノードがありません。");
      assertNonNullable(target, flow.targetId + " の終点ノードがありません。");
      assertNonNullable(sourceY, flow.id + " の始点位置がありません。");
      assertNonNullable(targetY, flow.id + " の終点位置がありません。");
      return {
        ...flow,
        path: createPath(
          source.x + source.width,
          sourceY,
          target.x,
          targetY,
        ),
        width: scoreWidth(flow.points),
      };
    })
    .sort(
      (left, right) =>
        Number(left.selected) - Number(right.selected) ||
        contributionKindOrder(left.kind) - contributionKindOrder(right.kind) ||
        left.id.localeCompare(right.id),
    );
}

function compareLinkedNodes(
  leftNodeId: string,
  rightNodeId: string,
  nodeById: Map<string, NodeLayout>,
  leftLink: FlowLink,
  rightLink: FlowLink,
): number {
  const leftNode = nodeById.get(leftNodeId);
  const rightNode = nodeById.get(rightNodeId);
  assertNonNullable(leftNode, leftNodeId + " の接続先ノードがありません。");
  assertNonNullable(rightNode, rightNodeId + " の接続先ノードがありません。");
  return (
    leftNode.y - rightNode.y ||
    contributionKindOrder(leftLink.kind) -
      contributionKindOrder(rightLink.kind) ||
    leftLink.id.localeCompare(rightLink.id)
  );
}

function groupLinks(
  links: FlowLink[],
  direction: "incoming" | "outgoing",
): Map<string, FlowLink[]> {
  const grouped = new Map<string, FlowLink[]>();
  for (const link of links) {
    const nodeId = direction === "incoming" ? link.targetId : link.sourceId;
    const current = grouped.get(nodeId);
    if (current == null) {
      grouped.set(nodeId, [link]);
      continue;
    }
    current.push(link);
  }
  return grouped;
}

function sumLinkWidths(
  links: FlowLink[],
  direction: "incoming" | "outgoing",
): Map<string, number> {
  return sumLinks(
    links,
    direction,
    (link) => scoreWidth(link.points),
  );
}

function sumLinkPoints(
  links: FlowLink[],
  direction: "incoming" | "outgoing",
): Map<string, number> {
  return sumLinks(links, direction, (link) => link.points);
}

function sumSelectedLinkPoints(links: FlowLink[]): Map<string, number> {
  const selected = links.filter((link) => link.selected);
  const incoming = sumLinkPoints(selected, "incoming");
  const outgoing = sumLinkPoints(selected, "outgoing");
  const totals = new Map(incoming);
  for (const [nodeId, points] of outgoing) {
    totals.set(nodeId, Math.max(points, totals.get(nodeId) ?? 0));
  }
  return totals;
}

function sumLinks(
  links: FlowLink[],
  direction: "incoming" | "outgoing",
  value: (link: FlowLink) => number,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const link of links) {
    const nodeId = direction === "incoming" ? link.targetId : link.sourceId;
    totals.set(nodeId, (totals.get(nodeId) ?? 0) + value(link));
  }
  return totals;
}

function assertWorkstreamConservation(workstream: WorkstreamScore): void {
  const allocatedPoints = sum(
    workstream.allocations.map((allocation) => allocation.points),
  );
  const unallocatedPoints = sum(
    workstream.unallocatedEntries.map((entry) => entry.points),
  );
  assertNearlyEqual(
    workstream.unallocatedPoints,
    unallocatedPoints,
    workstream.key + " の配点対象外の点と明細の合計が一致しません。",
  );
  assertNearlyEqual(
    workstream.importance,
    allocatedPoints + unallocatedPoints,
    workstream.key + " の総量と詳細経路の合計が一致しません。",
  );
}

function assertAllocationSource(
  allocation: ScoreAllocation,
  expectedType: SourceReference["type"],
  expectedKey: string,
  scopeKey: string,
): void {
  if (
    allocation.source.type !== expectedType ||
    allocation.source.key.toLowerCase() !== expectedKey.toLowerCase()
  ) {
    throw new Error(scopeKey + " の配点元が対象と一致しません。");
  }
}

function hasAllocationFor(
  allocations: ScoreAllocation[],
  login: string,
): boolean {
  return allocations.some(
    (allocation) => allocation.actor.login.toLowerCase() === login,
  );
}

function selectionMatchesWorkstream(
  selection: SankeyDiagramSelection,
  workstream: WorkstreamScore,
): boolean {
  switch (selection.type) {
    case "contributor":
      return hasAllocationFor(
        workstream.allocations,
        selection.contributor.login.toLowerCase(),
      );
    case "pull":
      return workstream.pulls.some(
        (pull) => pull.key.toLowerCase() === selection.key.toLowerCase(),
      );
    case "issue":
      return (
        workstream.issue?.key.toLowerCase() === selection.key.toLowerCase()
      );
    default:
      throw new UnreachableError(selection);
  }
}

function selectionMatchesStandaloneIssue(
  selection: SankeyDiagramSelection,
  issueKey: string,
  allocations: ScoreAllocation[],
): boolean {
  switch (selection.type) {
    case "contributor":
      return hasAllocationFor(
        allocations,
        selection.contributor.login.toLowerCase(),
      );
    case "pull":
      return false;
    case "issue":
      return issueKey.toLowerCase() === selection.key.toLowerCase();
    default:
      throw new UnreachableError(selection);
  }
}

function allocationMatchesWorkstreamSelection(
  selection: SankeyDiagramSelection,
  workstream: WorkstreamScore,
  allocation: ScoreAllocation,
): boolean {
  switch (selection.type) {
    case "contributor":
      return (
        allocation.actor.login.toLowerCase() ===
        selection.contributor.login.toLowerCase()
      );
    case "pull":
      if (allocation.kind === "issue") {
        return selectionMatchesWorkstream(selection, workstream);
      }
      return (
        allocation.source.type === "pull" &&
        allocation.source.key.toLowerCase() === selection.key.toLowerCase()
      );
    case "issue":
      return selectionMatchesWorkstream(selection, workstream);
    default:
      throw new UnreachableError(selection);
  }
}

function issueInputMatchesSelection(
  selection: SankeyDiagramSelection,
  workstream: WorkstreamScore,
  pullKey: string,
): boolean {
  switch (selection.type) {
    case "contributor":
      return selectionMatchesWorkstream(selection, workstream);
    case "pull":
      return pullKey.toLowerCase() === selection.key.toLowerCase();
    case "issue":
      return selectionMatchesWorkstream(selection, workstream);
    default:
      throw new UnreachableError(selection);
  }
}

function allocationMatchesStandaloneSelection(
  selection: SankeyDiagramSelection,
  issueKey: string,
  allocation: ScoreAllocation,
): boolean {
  switch (selection.type) {
    case "contributor":
      return (
        allocation.actor.login.toLowerCase() ===
        selection.contributor.login.toLowerCase()
      );
    case "pull":
      return false;
    case "issue":
      return issueKey.toLowerCase() === selection.key.toLowerCase();
    default:
      throw new UnreachableError(selection);
  }
}

function referenceMatchesSelection(
  selection: SankeyDiagramSelection,
  reference: SourceReference,
): boolean {
  switch (selection.type) {
    case "contributor":
      return false;
    case "pull":
      return (
        reference.type === "pull" &&
        reference.key.toLowerCase() === selection.key.toLowerCase()
      );
    case "issue":
      return (
        reference.type === "issue" &&
        reference.key.toLowerCase() === selection.key.toLowerCase()
      );
    default:
      throw new UnreachableError(selection);
  }
}

function actorMatchesSelection(
  selection: SankeyDiagramSelection,
  actor: Actor,
): boolean {
  switch (selection.type) {
    case "contributor":
      return (
        actor.login.toLowerCase() ===
        selection.contributor.login.toLowerCase()
      );
    case "pull":
    case "issue":
      return false;
    default:
      throw new UnreachableError(selection);
  }
}

function referenceNodeId(reference: SourceReference): string {
  return reference.type + ":" + reference.key.toLowerCase();
}

function actorNodeId(login: string): string {
  return "actor:" + login.toLowerCase();
}

function nodeX(role: SankeyDiagramNodeRole): number {
  switch (role) {
    case "pull":
      return pullX;
    case "issue":
      return issueX;
    case "actor":
      return actorX;
    default:
      throw new UnreachableError(role);
  }
}

function contributionKindOrder(kind: ContributionKind): number {
  switch (kind) {
    case "implementation":
      return 0;
    case "review":
      return 1;
    case "issue":
      return 2;
    default:
      throw new UnreachableError(kind);
  }
}

function assertNearlyEqual(
  expected: number,
  actual: number,
  message: string,
): void {
  if (Math.abs(expected - actual) > scoreTolerance(expected)) {
    throw new Error(
      message + "期待値 " + expected + "、実際の値 " + actual,
    );
  }
}

function scoreTolerance(value: number): number {
  return Math.max(1, value) * 1e-10;
}

function scoreWidth(points: number): number {
  if (points <= 0) {
    throw new Error("サンキー経路の点数が正の値ではありません。");
  }
  return Math.max(minimumFlowWidth, points * flowScale);
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

function compactReferenceLabel(source: SourceReference): string {
  const match = /^[^/]+\/([^#]+)#([1-9]\d*)$/.exec(source.key);
  const repository = match?.[1];
  const number = match?.[2];
  assertNonNullable(repository, "発生源キーにリポジトリ名がありません。");
  assertNonNullable(number, "発生源キーに番号がありません。");
  return truncate(repository, 11) + "#" + number;
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : value.slice(0, length - 1) + "…";
}

function formatScore(score: number): string {
  return score.toFixed(2);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
