import { assertNonNullable } from "../domain/errors.ts";
import type {
  Actor,
  ContributorScore,
  LeaderboardResult,
  ScoreAllocation,
  ScoreEntry,
  SourceReference,
} from "../domain/model.ts";
import { routeHref, sourceHref } from "./routes.ts";

export type SankeyDiagramNodeRole =
  | "source"
  | "activity"
  | "actor"
  | "outside";

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
  unallocated: boolean;
  href?: string | undefined;
}

export interface SankeyDiagramLink {
  id: string;
  path: string;
  width: number;
  label: string;
  selected: boolean;
  unallocated: boolean;
  href?: string | undefined;
}

export interface SankeyDiagramLayout {
  width: number;
  height: number;
  nodes: SankeyDiagramNode[];
  links: SankeyDiagramLink[];
  sourceCount: number;
  activityCount: number;
  selectedPoints: number;
  otherContributorPoints: number;
  unallocatedPoints: number;
}

interface SourceFlow {
  id: string;
  reference: SourceReference;
  title: string;
  points: number;
  selectedPoints: number;
  activities: ActivityFlow[];
}

interface ActivityFlowBase {
  id: string;
  entry: ScoreEntry;
  destinationId: string;
  selected: boolean;
}

type ActivityFlow =
  | (ActivityFlowBase & {
      outcome: "actor";
      actor: Actor;
    })
  | (ActivityFlowBase & { outcome: "outside" });

interface ActorDestination {
  id: string;
  outcome: "actor";
  actor: Actor;
  points: number;
  selected: boolean;
}

interface OutsideDestination {
  id: string;
  outcome: "outside";
  entry: ScoreEntry;
  points: number;
  selected: false;
}

type DestinationFlow = ActorDestination | OutsideDestination;

interface ActivityLayout {
  flow: ActivityFlow;
  y: number;
  height: number;
  flowWidth: number;
}

interface SourceLayout {
  flow: SourceFlow;
  y: number;
  height: number;
  flowHeight: number;
  activities: ActivityLayout[];
}

interface DestinationLayout {
  flow: DestinationFlow;
  y: number;
  height: number;
  flowHeight: number;
}

interface ColumnLayout<T> {
  height: number;
  items: T[];
}

const diagramWidth = 1160;
const diagramPadding = 32;
const sourceX = 20;
const sourceWidth = 230;
const activityX = 340;
const activityWidth = 400;
const destinationX = 860;
const destinationWidth = 280;
const flowScale = 10;
const minimumFlowWidth = 1;
const minimumNodeHeight = 34;
const activityGap = 10;
const sourceGap = 32;

/** 人物に関係する全配点経路から詳細サンキーダイアグラムを作る。 */
export function createSankeyDiagramLayout(
  result: LeaderboardResult,
  contributor: ContributorScore,
): SankeyDiagramLayout {
  const sources = collectSources(result, contributor);
  if (sources.length === 0) {
    throw new Error("人物に関係するポイント発生源がありません。");
  }
  const sourceColumn = layoutSources(sources);
  const destinations = collectDestinations(sources);
  const destinationColumn = layoutDestinations(
    destinations,
    sourceColumn,
  );
  const contentHeight = Math.max(
    sourceColumn.height,
    destinationColumn.height,
  );
  const sourceShift =
    diagramPadding + (contentHeight - sourceColumn.height) / 2;
  const destinationShift =
    diagramPadding + (contentHeight - destinationColumn.height) / 2;
  const nodes = createNodes(
    result,
    sourceColumn.items,
    sourceShift,
    destinationColumn.items,
    destinationShift,
  );
  const links = createLinks(
    result,
    sourceColumn.items,
    sourceShift,
    destinationColumn.items,
    destinationShift,
  );
  const unallocatedPoints = sum(
    sources.flatMap((source) =>
      source.activities
        .filter((activity) => activity.outcome === "outside")
        .map((activity) => activity.entry.points),
    ),
  );
  const sourcePoints = sum(sources.map((source) => source.points));
  const otherContributorPoints =
    sourcePoints - contributor.score - unallocatedPoints;
  assertNearlyEqual(
    contributor.score,
    sum(
      sources.flatMap((source) =>
        source.activities
          .filter((activity) => activity.selected)
          .map((activity) => activity.entry.points),
      ),
    ),
    "人物の合計点と図内の選択人物への流入点が一致しません。",
  );
  if (otherContributorPoints < -scoreTolerance(sourcePoints)) {
    throw new Error("他の人物へ配分された点が負の値になりました。");
  }

  return {
    width: diagramWidth,
    height: contentHeight + diagramPadding * 2,
    nodes,
    links,
    sourceCount: sources.length,
    activityCount: sum(sources.map((source) => source.activities.length)),
    selectedPoints: contributor.score,
    otherContributorPoints: Math.max(0, otherContributorPoints),
    unallocatedPoints,
  };
}

function collectSources(
  result: LeaderboardResult,
  contributor: ContributorScore,
): SourceFlow[] {
  const login = contributor.login.toLowerCase();
  const sources: SourceFlow[] = [];
  for (const workstream of result.workstreams) {
    if (
      workstream.allocations.some(
        (allocation) => allocation.actor.login.toLowerCase() === login,
      ) === false
    ) {
      continue;
    }
    const id = "workstream:" + workstream.key;
    const activities = [
      ...workstream.allocations.map((allocation) =>
        createAllocatedActivity(id, allocation, login),
      ),
      ...workstream.unallocatedEntries.map((entry) =>
        createOutsideActivity(id, entry),
      ),
    ].sort(compareActivities);
    assertSourceConservation(workstream.importance, activities, id);
    sources.push({
      id,
      reference: workstream.source,
      title: workstream.title,
      points: workstream.importance,
      selectedPoints: selectedActivityPoints(activities),
      activities,
    });
  }

  for (const standalone of result.standaloneIssues) {
    if (
      standalone.allocations.some(
        (allocation) => allocation.actor.login.toLowerCase() === login,
      ) === false
    ) {
      continue;
    }
    const id = "standalone:" + standalone.key;
    const activities = standalone.allocations
      .map((allocation) => createAllocatedActivity(id, allocation, login))
      .sort(compareActivities);
    assertSourceConservation(standalone.score, activities, id);
    sources.push({
      id,
      reference: { type: "issue", key: standalone.key },
      title: standalone.title,
      points: standalone.score,
      selectedPoints: selectedActivityPoints(activities),
      activities,
    });
  }

  const selectedIds = sources
    .flatMap((source) => source.activities)
    .filter((activity) => activity.selected)
    .map((activity) => activity.entry.id)
    .sort();
  const contributorIds = contributor.entries.map((entry) => entry.id).sort();
  if (
    selectedIds.length !== contributorIds.length ||
    selectedIds.some((id, index) => id !== contributorIds[index])
  ) {
    throw new Error("人物の配点明細とサンキーダイアグラムの経路が一致しません。");
  }

  return sources.sort(
    (left, right) =>
      right.selectedPoints - left.selectedPoints ||
      left.id.localeCompare(right.id),
  );
}

function createAllocatedActivity(
  sourceId: string,
  allocation: ScoreAllocation,
  selectedLogin: string,
): ActivityFlow {
  const login = allocation.actor.login.toLowerCase();
  const id = sourceId + ":activity:" + allocation.id;
  return {
    id,
    outcome: "actor",
    entry: allocation,
    actor: allocation.actor,
    destinationId: "destination:" + id,
    selected: login === selectedLogin,
  };
}

function createOutsideActivity(
  sourceId: string,
  entry: ScoreEntry,
): ActivityFlow {
  const id = sourceId + ":activity:" + entry.id;
  return {
    id,
    outcome: "outside",
    entry,
    destinationId: "destination:" + id,
    selected: false,
  };
}

function compareActivities(left: ActivityFlow, right: ActivityFlow): number {
  return (
    activityOrder(left) - activityOrder(right) ||
    right.entry.points - left.entry.points ||
    left.id.localeCompare(right.id)
  );
}

function activityOrder(activity: ActivityFlow): number {
  if (activity.selected) {
    return 0;
  }
  return activity.outcome === "actor" ? 1 : 2;
}

function selectedActivityPoints(activities: ActivityFlow[]): number {
  return sum(
    activities
      .filter((activity) => activity.selected)
      .map((activity) => activity.entry.points),
  );
}

function collectDestinations(
  sources: SourceFlow[],
): DestinationFlow[] {
  return sources.flatMap((source) =>
    source.activities.map((activity): DestinationFlow => {
      if (activity.outcome === "outside") {
        return {
          id: activity.destinationId,
          outcome: "outside",
          entry: activity.entry,
          points: activity.entry.points,
          selected: false,
        };
      }
      return {
        id: activity.destinationId,
        outcome: "actor",
        actor: activity.actor,
        points: activity.entry.points,
        selected: activity.selected,
      };
    }),
  );
}

function layoutSources(sources: SourceFlow[]): ColumnLayout<SourceLayout> {
  const layouts: SourceLayout[] = [];
  let nextY = 0;
  for (const source of sources) {
    const activityLayouts = source.activities.map((activity) => {
      const width = scoreWidth(activity.entry.points);
      return {
        flow: activity,
        y: 0,
        height: Math.max(minimumNodeHeight, width),
        flowWidth: width,
      };
    });
    const activityHeight =
      sum(activityLayouts.map((layout) => layout.height)) +
      activityGap * Math.max(0, activityLayouts.length - 1);
    const flowHeight = sum(
      activityLayouts.map((layout) => layout.flowWidth),
    );
    const sourceHeight = Math.max(minimumNodeHeight, flowHeight);
    const groupHeight = Math.max(sourceHeight, activityHeight);
    let activityY = nextY + (groupHeight - activityHeight) / 2;
    for (const activity of activityLayouts) {
      activity.y = activityY;
      activityY += activity.height + activityGap;
    }
    layouts.push({
      flow: source,
      y: nextY + (groupHeight - sourceHeight) / 2,
      height: sourceHeight,
      flowHeight,
      activities: activityLayouts,
    });
    nextY += groupHeight + sourceGap;
  }
  return {
    height: nextY - sourceGap,
    items: layouts,
  };
}

function layoutDestinations(
  destinations: DestinationFlow[],
  sourceColumn: ColumnLayout<SourceLayout>,
): ColumnLayout<DestinationLayout> {
  const destinationsById = new Map(
    destinations.map((destination) => [destination.id, destination]),
  );
  const layouts = sourceColumn.items.flatMap((source) =>
    source.activities.map((activity): DestinationLayout => {
      const destination = destinationsById.get(
        activity.flow.destinationId,
      );
      assertNonNullable(
        destination,
        activity.flow.destinationId + " の終点がありません。",
      );
      return {
        flow: destination,
        y: activity.y,
        height: activity.height,
        flowHeight: activity.flowWidth,
      };
    }),
  );
  if (layouts.length !== destinations.length) {
    throw new Error("サンキー経路と終点の件数が一致しません。");
  }
  return {
    height: sourceColumn.height,
    items: layouts,
  };
}

function createNodes(
  result: LeaderboardResult,
  sources: SourceLayout[],
  sourceShift: number,
  destinations: DestinationLayout[],
  destinationShift: number,
): SankeyDiagramNode[] {
  const nodes: SankeyDiagramNode[] = [];
  for (const source of sources) {
    nodes.push({
      id: source.flow.id,
      role: "source",
      label:
        compactReferenceLabel(source.flow.reference) +
        " " +
        truncate(source.flow.title, 9),
      description:
        source.flow.title + "、総量 " + formatScore(source.flow.points) + " 点",
      points: source.flow.points,
      x: sourceX,
      y: source.y + sourceShift,
      width: sourceWidth,
      height: source.height,
      selected: false,
      unallocated: false,
      href: sourceHref(source.flow.reference, result.range),
    });
    for (const activity of source.activities) {
      nodes.push({
        id: activity.flow.id,
        role: "activity",
        label: truncate(activity.flow.entry.reason, 30),
        description:
          activity.flow.entry.sourceTitle +
          "。" +
          activity.flow.entry.reason +
          "。" +
          formatScore(activity.flow.entry.points) +
          " 点",
        points: activity.flow.entry.points,
        x: activityX,
        y: activity.y + sourceShift,
        width: activityWidth,
        height: activity.height,
        selected: activity.flow.selected,
        unallocated: activity.flow.outcome === "outside",
        href: sourceHref(activity.flow.entry.source, result.range),
      });
    }
  }

  for (const destination of destinations) {
    if (destination.flow.outcome === "actor") {
      nodes.push({
        id: destination.flow.id,
        role: "actor",
        label:
          destination.flow.actor.login +
          " " +
          formatScore(destination.flow.points) +
          " 点",
        description:
          destination.flow.actor.login +
          " へこの図から " +
          formatScore(destination.flow.points) +
          " 点",
        points: destination.flow.points,
        x: destinationX,
        y: destination.y + destinationShift,
        width: destinationWidth,
        height: destination.height,
        selected: destination.flow.selected,
        unallocated: false,
        href: routeHref(
          { name: "person", login: destination.flow.actor.login },
          result.range,
        ),
      });
      continue;
    }
    nodes.push({
      id: destination.flow.id,
      role: "outside",
      label: "図外へ流出 → " + formatScore(destination.flow.points) + " 点",
      description:
        destination.flow.entry.reason +
        "。" +
        formatScore(destination.flow.points) +
        " 点は誰にも配分されません。",
      points: destination.flow.points,
      x: destinationX,
      y: destination.y + destinationShift,
      width: destinationWidth,
      height: destination.height,
      selected: false,
      unallocated: true,
    });
  }
  return nodes;
}

function createLinks(
  result: LeaderboardResult,
  sources: SourceLayout[],
  sourceShift: number,
  destinations: DestinationLayout[],
  destinationShift: number,
): SankeyDiagramLink[] {
  const links: SankeyDiagramLink[] = [];
  const destinationsById = new Map(
    destinations.map((destination) => [destination.flow.id, destination]),
  );
  const destinationOffsets = new Map(
    destinations.map((destination) => [
      destination.flow.id,
      (destination.height - destination.flowHeight) / 2,
    ]),
  );
  for (const source of sources) {
    let sourceOffset = (source.height - source.flowHeight) / 2;
    for (const activity of source.activities) {
      const activityCenter =
        activity.y + sourceShift + activity.height / 2;
      const sourceCenter =
        source.y + sourceShift + sourceOffset + activity.flowWidth / 2;
      const unallocated = activity.flow.outcome === "outside";
      const activityHref = sourceHref(activity.flow.entry.source, result.range);
      links.push({
        id: source.flow.id + ":to:" + activity.flow.id,
        path: createPath(
          sourceX + sourceWidth,
          sourceCenter,
          activityX,
          activityCenter,
        ),
        width: activity.flowWidth,
        label:
          source.flow.title +
          " から " +
          activity.flow.entry.reason +
          " へ " +
          formatScore(activity.flow.entry.points) +
          " 点",
        selected: activity.flow.selected,
        unallocated,
        href: activityHref,
      });
      sourceOffset += activity.flowWidth;

      const destination = destinationsById.get(
        activity.flow.destinationId,
      );
      const destinationOffset = destinationOffsets.get(
        activity.flow.destinationId,
      );
      assertNonNullable(
        destination,
        activity.flow.destinationId + " の終点ノードがありません。",
      );
      assertNonNullable(
        destinationOffset,
        activity.flow.destinationId + " の終点位置がありません。",
      );
      const destinationCenter =
        destination.y +
        destinationShift +
        destinationOffset +
        activity.flowWidth / 2;
      links.push({
        id: activity.flow.id + ":to:" + activity.flow.destinationId,
        path: createPath(
          activityX + activityWidth,
          activityCenter,
          destinationX,
          destinationCenter,
        ),
        width: activity.flowWidth,
        label: createDestinationLinkLabel(activity),
        selected: activity.flow.selected,
        unallocated,
        ...(activity.flow.outcome === "actor"
          ? {
              href: routeHref(
                { name: "person", login: activity.flow.actor.login },
                result.range,
              ),
            }
          : {}),
      });
      destinationOffsets.set(
        activity.flow.destinationId,
        destinationOffset + activity.flowWidth,
      );
    }
  }
  return links;
}

function createDestinationLinkLabel(activity: ActivityLayout): string {
  const points = formatScore(activity.flow.entry.points);
  if (activity.flow.outcome === "outside") {
    return activity.flow.entry.reason + "により " + points + " 点が図外へ流出";
  }
  return (
    activity.flow.entry.reason +
    "から " +
    activity.flow.actor.login +
    " へ " +
    points +
    " 点"
  );
}

function assertSourceConservation(
  expectedPoints: number,
  activities: ActivityFlow[],
  sourceId: string,
): void {
  assertNearlyEqual(
    expectedPoints,
    sum(activities.map((activity) => activity.entry.points)),
    sourceId + " の総量と詳細経路の合計が一致しません。",
  );
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
