<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import IssuePage from "./components/IssuePage.vue";
import IssueListPage from "./components/IssueListPage.vue";
import LeaderboardTable from "./components/LeaderboardTable.vue";
import MethodologyPage from "./components/MethodologyPage.vue";
import PersonPage from "./components/PersonPage.vue";
import PullListPage from "./components/PullListPage.vue";
import PullPage from "./components/PullPage.vue";
import { parseLeaderboardDataset } from "./domain/dataset.ts";
import type {
  DateRange,
  LeaderboardDataset,
  LeaderboardResult,
} from "./domain/model.ts";
import { calculateLeaderboard } from "./services/calculateLeaderboard.ts";
import {
  resolveRangeSelection,
  type RangeSelection,
  type ResolvedRangeSelection,
} from "./services/calculationScope.ts";
import {
  isApplicationPath,
  parseAppLocation,
  routeHref,
  type AppLocation,
} from "./services/routes.ts";

interface LoadingState {
  status: "loading";
}

interface ErrorState {
  status: "error";
  message: string;
}

interface ReadyState {
  status: "ready";
  dataset: LeaderboardDataset;
  result: LeaderboardResult;
  rangeSelection: RangeSelection;
  draftRange: DateRange;
  rangeError: string;
}

type ViewState = LoadingState | ErrorState | ReadyState;

const viewState = shallowRef<ViewState>({ status: "loading" });
const appLocation = shallowRef<AppLocation>(
  parseAppLocation(window.location.href),
);
const rangePanelOpen = ref(false);
const loadingHomeHref = import.meta.env.BASE_URL;

const readyState = computed<ReadyState | undefined>(() =>
  viewState.value.status === "ready" ? viewState.value : undefined,
);

const draftStart = computed<string>({
  get: () => requireReadyState().draftRange.start,
  set: (start) => {
    const state = requireReadyState();
    viewState.value = {
      ...state,
      draftRange: { ...state.draftRange, start },
      rangeError: "",
    };
  },
});

const draftEnd = computed<string>({
  get: () => requireReadyState().draftRange.end,
  set: (end) => {
    const state = requireReadyState();
    viewState.value = {
      ...state,
      draftRange: { ...state.draftRange, end },
      rangeError: "",
    };
  },
});

const fullAiRepositories = computed(() => {
  const state = readyState.value;
  if (state == null) {
    return [];
  }
  return state.dataset.repositories
    .filter((repository) => repository.fullAiImplementation)
    .map((repository) => repository.nameWithOwner);
});

const currentContributor = computed(() => {
  const state = readyState.value;
  const route = appLocation.value.route;
  if (state == null || route.name !== "person") {
    return undefined;
  }
  return state.result.contributors.find(
    (contributor) =>
      contributor.login.toLowerCase() === route.login.toLowerCase(),
  );
});

const currentPull = computed(() => {
  const state = readyState.value;
  const route = appLocation.value.route;
  if (state == null || route.name !== "pull") {
    return undefined;
  }
  return state.dataset.pulls.find((pull) => pull.key === route.key);
});

const currentPullWorkstream = computed(() => {
  const state = readyState.value;
  const pull = currentPull.value;
  if (state == null || pull == null) {
    return undefined;
  }
  return state.result.workstreams.find((workstream) =>
    workstream.pulls.some((candidate) => candidate.key === pull.key),
  );
});

const currentIssue = computed(() => {
  const state = readyState.value;
  const route = appLocation.value.route;
  if (state == null || route.name !== "issue") {
    return undefined;
  }
  return state.dataset.issues.find((issue) => issue.key === route.key);
});

const currentIssueWorkstreams = computed(() => {
  const state = readyState.value;
  const issue = currentIssue.value;
  if (state == null || issue == null) {
    return [];
  }
  return state.result.workstreams.filter(
    (workstream) => workstream.issue?.key === issue.key,
  );
});

const currentStandaloneIssue = computed(() => {
  const state = readyState.value;
  const issue = currentIssue.value;
  if (state == null || issue == null) {
    return undefined;
  }
  return state.result.standaloneIssues.find(
    (standalone) => standalone.key === issue.key,
  );
});

onMounted(() => {
  window.addEventListener("popstate", handleLocationChange);
  window.document.addEventListener("click", handleDocumentClick);
  void loadDataset();
});

onBeforeUnmount(() => {
  window.removeEventListener("popstate", handleLocationChange);
  window.document.removeEventListener("click", handleDocumentClick);
});

async function loadDataset(): Promise<void> {
  try {
    const response = await fetch(
      import.meta.env.BASE_URL + "data/leaderboard-data.json",
      { cache: "no-cache" },
    );
    if (response.ok === false) {
      throw new Error(
        "事前取得データを読み込めません。HTTP " + response.status,
      );
    }
    let raw: unknown;
    try {
      raw = await response.json();
    } catch (error) {
      throw new Error("事前取得データを JSON として解釈できません。", {
        cause: error,
      });
    }
    const dataset = parseLeaderboardDataset(raw);
    const location = parseAppLocation(window.location.href);
    const resolvedRange = resolveLocationRange(
      location,
      createInitialRangeSelection(),
      dataset.range,
    );
    const result = calculateLeaderboard(dataset, resolvedRange.range);
    viewState.value = {
      status: "ready",
      dataset,
      result,
      rangeSelection: resolvedRange.selection,
      draftRange: resolvedRange.range,
      rangeError: "",
    };
    appLocation.value = {
      route: location.route,
      rangeSelection: resolvedRange.selection,
    };
    window.history.replaceState(
      null,
      "",
      routeHref(location.route, resolvedRange.selection),
    );
  } catch (error) {
    console.error("事前取得データの読み込みに失敗しました", error);
    viewState.value = {
      status: "error",
      message: describeError(error),
    };
  }
}

function applyRange(): void {
  const state = requireReadyState();
  try {
    const resolvedRange = resolveRangeSelection(
      { type: "absolute", range: state.draftRange },
      state.dataset.range,
    );
    const result = calculateLeaderboard(state.dataset, resolvedRange.range);
    viewState.value = {
      ...state,
      result,
      rangeSelection: resolvedRange.selection,
      draftRange: resolvedRange.range,
      rangeError: "",
    };
    const location: AppLocation = {
      route: appLocation.value.route,
      rangeSelection: resolvedRange.selection,
    };
    appLocation.value = location;
    window.history.pushState(
      null,
      "",
      routeHref(location.route, resolvedRange.selection),
    );
    rangePanelOpen.value = false;
  } catch (error) {
    viewState.value = {
      ...state,
      rangeError: describeError(error),
    };
  }
}

function setAllRange(): void {
  const state = requireReadyState();
  viewState.value = {
    ...state,
    draftRange: state.dataset.range,
    rangeError: "",
  };
}

function handleLocationChange(): void {
  const location = parseAppLocation(window.location.href);
  const state = readyState.value;
  rangePanelOpen.value = false;
  if (state == null) {
    appLocation.value = location;
    return;
  }
  const resolvedRange = resolveLocationRange(
    location,
    createInitialRangeSelection(),
    state.dataset.range,
  );
  viewState.value = {
    ...state,
    result:
      rangesEqual(resolvedRange.range, state.result.range)
        ? state.result
        : calculateLeaderboard(state.dataset, resolvedRange.range),
    rangeSelection: resolvedRange.selection,
    draftRange: resolvedRange.range,
    rangeError: "",
  };
  appLocation.value = {
    route: location.route,
    rangeSelection: resolvedRange.selection,
  };
  window.history.replaceState(
    null,
    "",
    routeHref(location.route, resolvedRange.selection),
  );
}

function handleDocumentClick(event: MouseEvent): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  const target = event.target;
  if (target instanceof window.Element === false) {
    return;
  }
  const anchor = target.closest("a");
  if (
    anchor == null ||
    anchor.target !== "" ||
    anchor.hasAttribute("download")
  ) {
    return;
  }
  const url = new window.URL(anchor.href);
  if (
    url.origin !== window.location.origin ||
    isApplicationPath(url.pathname) === false
  ) {
    return;
  }
  event.preventDefault();
  window.history.pushState(null, "", url);
  handleLocationChange();
  window.scrollTo({ top: 0, behavior: "auto" });
}

function openRangePanel(): void {
  const state = requireReadyState();
  viewState.value = {
    ...state,
    draftRange: state.result.range,
    rangeError: "",
  };
  rangePanelOpen.value = true;
}

function closeRangePanel(): void {
  rangePanelOpen.value = false;
}

function resolveLocationRange(
  location: AppLocation,
  fallbackSelection: RangeSelection,
  availableRange: DateRange,
): ResolvedRangeSelection {
  const selection = location.rangeSelection ?? fallbackSelection;
  try {
    return resolveRangeSelection(selection, availableRange);
  } catch (error) {
    console.warn("URL の対象期間を適用できないため既定期間を使います", error);
    return resolveRangeSelection(fallbackSelection, availableRange);
  }
}

function createInitialRangeSelection(): RangeSelection {
  return { type: "relative", count: 30, unit: "day" };
}

function rangesEqual(left: DateRange, right: DateRange): boolean {
  return left.start === right.start && left.end === right.end;
}

function requireReadyState(): ReadyState {
  const state = viewState.value;
  if (state.status !== "ready") {
    throw new Error("事前取得データの読み込みが完了していません。");
  }
  return state;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  console.error("Error 以外の値が投げられました", error);
  return "想定外のエラーが発生しました。";
}
</script>

<template>
  <div class="min-h-screen">
    <header class="border-b border-line bg-surface">
      <div class="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
        <a
          :href="readyState == null ? loadingHomeHref : routeHref({ name: 'home' }, readyState.rangeSelection)"
          class="font-display text-sm font-semibold tracking-wide"
        >
          VOICEVOX Leaderboard
        </a>
        <nav
          v-if="readyState != null"
          aria-label="主要ページ"
          class="order-3 flex w-full items-center gap-4 overflow-x-auto pt-1 text-xs font-semibold text-muted md:order-none md:w-auto md:pt-0"
        >
          <a
            :href="routeHref({ name: 'home' }, readyState.rangeSelection)"
            :aria-current="appLocation.route.name === 'home' ? 'page' : undefined"
            :class="appLocation.route.name === 'home' ? 'text-accent-dark' : 'hover:text-ink'"
          >
            リーダーボード
          </a>
          <a
            :href="routeHref({ name: 'pulls' }, readyState.rangeSelection)"
            :aria-current="appLocation.route.name === 'pulls' || appLocation.route.name === 'pull' ? 'page' : undefined"
            :class="appLocation.route.name === 'pulls' || appLocation.route.name === 'pull' ? 'text-accent-dark' : 'hover:text-ink'"
          >
            PR
          </a>
          <a
            :href="routeHref({ name: 'issues' }, readyState.rangeSelection)"
            :aria-current="appLocation.route.name === 'issues' || appLocation.route.name === 'issue' ? 'page' : undefined"
            :class="appLocation.route.name === 'issues' || appLocation.route.name === 'issue' ? 'text-accent-dark' : 'hover:text-ink'"
          >
            Issue
          </a>
          <a
            :href="routeHref({ name: 'methodology' }, readyState.rangeSelection)"
            :aria-current="appLocation.route.name === 'methodology' ? 'page' : undefined"
            :class="appLocation.route.name === 'methodology' ? 'text-accent-dark' : 'hover:text-ink'"
          >
            計算式
          </a>
        </nav>
        <div class="flex items-center gap-2">
          <span class="rounded-full border border-accent/30 bg-accent-soft px-3 py-1 text-xs font-semibold text-accent-dark">
            Prototype
          </span>
          <div
            v-if="readyState != null"
            class="relative"
          >
            <button
              type="button"
              class="rounded-xl border border-line bg-white px-3 py-2 text-xs font-semibold hover:border-accent hover:text-accent-dark"
              aria-controls="range-panel"
              :aria-expanded="rangePanelOpen"
              @click="rangePanelOpen ? closeRangePanel() : openRangePanel()"
            >
              期間 {{ readyState.result.range.start }} — {{ readyState.result.range.end }}
            </button>

            <form
              v-if="rangePanelOpen"
              id="range-panel"
              role="dialog"
              aria-labelledby="range-panel-heading"
              class="absolute right-0 mt-2 w-[min(22rem,calc(100vw-2.5rem))] rounded-2xl border border-line bg-surface p-5 shadow-[0_18px_60px_rgba(34,52,45,0.16)]"
              @submit.prevent="applyRange"
            >
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-xs font-semibold tracking-wide text-muted uppercase">
                    Target range
                  </p>
                  <h2
                    id="range-panel-heading"
                    class="mt-1 font-display text-lg font-semibold"
                  >
                    表示する期間
                  </h2>
                </div>
                <button
                  type="button"
                  class="rounded-lg px-2 py-1 text-sm text-muted hover:bg-paper hover:text-ink"
                  aria-label="期間設定を閉じる"
                  @click="closeRangePanel"
                >
                  閉じる
                </button>
              </div>
              <p class="mt-3 text-xs leading-5 text-muted">
                取得済み期間 {{ readyState.dataset.range.start }} —
                {{ readyState.dataset.range.end }}
              </p>

              <div class="mt-4 flex flex-wrap gap-3 text-xs">
                <a
                  :href="routeHref(appLocation.route, { type: 'relative', count: 7, unit: 'day' })"
                  class="font-semibold text-accent hover:underline"
                >
                  直近 7 日
                </a>
                <a
                  :href="routeHref(appLocation.route, { type: 'relative', count: 30, unit: 'day' })"
                  class="font-semibold text-accent hover:underline"
                >
                  直近 30 日
                </a>
                <a
                  :href="routeHref(appLocation.route, { type: 'relative', count: 2, unit: 'week' })"
                  class="font-semibold text-accent hover:underline"
                >
                  直近 2 週間
                </a>
                <a
                  :href="routeHref(appLocation.route, { type: 'relative', count: 1, unit: 'month' })"
                  class="font-semibold text-accent hover:underline"
                >
                  直近 1 か月
                </a>
                <button
                  type="button"
                  class="font-semibold text-accent hover:underline"
                  @click="setAllRange"
                >
                  取得済み全期間
                </button>
              </div>

              <div
                class="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2"
              >
                <input
                  v-model="draftStart"
                  type="date"
                  required
                  :min="readyState.dataset.range.start"
                  :max="readyState.dataset.range.end"
                  class="min-w-0 rounded-xl border border-line bg-white px-3 py-2.5 text-sm"
                >
                <span class="text-muted">—</span>
                <input
                  v-model="draftEnd"
                  type="date"
                  required
                  :min="readyState.dataset.range.start"
                  :max="readyState.dataset.range.end"
                  class="min-w-0 rounded-xl border border-line bg-white px-3 py-2.5 text-sm"
                >
              </div>
              <p class="mt-3 text-xs leading-5 text-muted">
                直近期間のリンクは URL に期間を保持し、データ更新後も最新の終了日を基準に表示します。
              </p>
              <p
                v-if="readyState.rangeError !== ''"
                class="mt-3 text-sm text-danger"
              >
                {{ readyState.rangeError }}
              </p>
              <button
                type="submit"
                class="mt-4 w-full rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white hover:bg-accent-dark"
              >
                この期間を表示する
              </button>
              <p class="mt-3 text-xs leading-5 text-muted">
                データ更新 {{ formatDateTime(readyState.dataset.generatedAt) }}
              </p>
            </form>
          </div>
        </div>
      </div>
    </header>

    <main
      v-if="viewState.status === 'loading'"
      class="mx-auto max-w-3xl px-5 py-24 text-center"
    >
      <span class="inline-block size-7 animate-spin rounded-full border-2 border-line border-t-accent" />
      <p class="mt-4 font-semibold">
        事前取得データを読み込んでいます
      </p>
    </main>

    <main
      v-else-if="viewState.status === 'error'"
      class="mx-auto max-w-3xl px-5 py-24"
    >
      <div class="rounded-2xl border border-danger/30 bg-red-50 p-6 text-danger">
        <h1 class="font-display text-xl font-semibold">
          リーダーボードを表示できません
        </h1>
        <p class="mt-2 text-sm leading-7">
          {{ viewState.message }}
        </p>
      </div>
    </main>

    <template v-else-if="readyState != null">
      <main
        v-if="appLocation.route.name === 'home'"
        class="mx-auto max-w-7xl px-5 py-10 sm:px-8 sm:py-14"
      >
        <LeaderboardTable
          :result="readyState.result"
          :range-selection="readyState.rangeSelection"
        />
      </main>

      <PullListPage
        v-else-if="appLocation.route.name === 'pulls'"
        :pulls="readyState.dataset.pulls"
        :range="readyState.result.range"
        :range-selection="readyState.rangeSelection"
      />

      <IssueListPage
        v-else-if="appLocation.route.name === 'issues'"
        :issues="readyState.dataset.issues"
        :range="readyState.result.range"
        :range-selection="readyState.rangeSelection"
      />

      <MethodologyPage
        v-else-if="appLocation.route.name === 'methodology'"
        :notices="readyState.dataset.notices"
        :full-ai-repositories="fullAiRepositories"
        :range="readyState.result.range"
      />

      <PersonPage
        v-else-if="appLocation.route.name === 'person' && currentContributor != null"
        :contributor="currentContributor"
        :range="readyState.result.range"
        :result="readyState.result"
        :range-selection="readyState.rangeSelection"
      />

      <PullPage
        v-else-if="appLocation.route.name === 'pull' && currentPull != null"
        :pull="currentPull"
        :workstream="currentPullWorkstream"
        :range="readyState.result.range"
        :result="readyState.result"
        :range-selection="readyState.rangeSelection"
      />

      <IssuePage
        v-else-if="appLocation.route.name === 'issue' && currentIssue != null"
        :issue="currentIssue"
        :workstreams="currentIssueWorkstreams"
        :standalone="currentStandaloneIssue"
        :range="readyState.result.range"
        :result="readyState.result"
        :range-selection="readyState.rangeSelection"
      />

      <main
        v-else
        class="mx-auto max-w-3xl px-5 py-24 text-center"
      >
        <p class="text-xs font-semibold tracking-[0.18em] text-accent uppercase">
          Not found
        </p>
        <h1 class="mt-3 font-display text-3xl font-semibold">
          対象のページが見つかりません
        </h1>
        <p class="mt-3 text-sm text-muted">
          選択期間に人物の配点がないか、取得済みデータに項目がありません。
        </p>
        <a
          :href="routeHref({ name: 'home' }, readyState.rangeSelection)"
          class="mt-6 inline-block font-semibold text-accent hover:underline"
        >
          リーダーボードへ戻る
        </a>
      </main>
    </template>
  </div>
</template>
