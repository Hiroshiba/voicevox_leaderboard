<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import IssuePage from "./components/IssuePage.vue";
import LeaderboardTable from "./components/LeaderboardTable.vue";
import MethodologyPanel from "./components/MethodologyPanel.vue";
import PersonPage from "./components/PersonPage.vue";
import PullPage from "./components/PullPage.vue";
import WorkstreamList from "./components/WorkstreamList.vue";
import { parseLeaderboardDataset } from "./domain/dataset.ts";
import type {
  DateRange,
  LeaderboardDataset,
  LeaderboardResult,
} from "./domain/model.ts";
import { calculateLeaderboard } from "./services/calculateLeaderboard.ts";
import { parseDateRange } from "./services/calculationScope.ts";
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
    const fallbackRange = createInitialRange(dataset.range);
    const range = resolveLocationRange(location, fallbackRange, dataset.range);
    const result = calculateLeaderboard(dataset, range);
    viewState.value = {
      status: "ready",
      dataset,
      result,
      draftRange: range,
      rangeError: "",
    };
    appLocation.value = { route: location.route, range };
    window.history.replaceState(
      null,
      "",
      routeHref(location.route, range),
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
    const range = parseDateRange(state.draftRange, state.dataset.range);
    const result = calculateLeaderboard(state.dataset, range);
    viewState.value = {
      ...state,
      result,
      draftRange: range,
      rangeError: "",
    };
    const location: AppLocation = {
      route: appLocation.value.route,
      range,
    };
    appLocation.value = location;
    window.history.pushState(null, "", routeHref(location.route, range));
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

function setRecentDays(dayCount: number): void {
  const state = requireReadyState();
  const start = subtractDays(state.dataset.range.end, dayCount - 1);
  viewState.value = {
    ...state,
    draftRange: {
      start: start < state.dataset.range.start ? state.dataset.range.start : start,
      end: state.dataset.range.end,
    },
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
  if (
    location.range != null &&
    rangesEqual(location.range, state.result.range) === false
  ) {
    try {
      const range = parseDateRange(location.range, state.dataset.range);
      viewState.value = {
        ...state,
        result: calculateLeaderboard(state.dataset, range),
        draftRange: range,
        rangeError: "",
      };
    } catch (error) {
      console.warn("URL の対象期間を適用できません", error);
    }
  }
  appLocation.value = location;
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
  fallbackRange: DateRange,
  availableRange: DateRange,
): DateRange {
  if (location.range == null) {
    return fallbackRange;
  }
  try {
    return parseDateRange(location.range, availableRange);
  } catch (error) {
    console.warn("URL の対象期間を適用できないため既定期間を使います", error);
    return fallbackRange;
  }
}

function createInitialRange(availableRange: DateRange): DateRange {
  const recentStart = subtractDays(availableRange.end, 29);
  return {
    start:
      recentStart < availableRange.start ? availableRange.start : recentStart,
    end: availableRange.end,
  };
}

function subtractDays(value: string, dayCount: number): string {
  const date = new Date(value + "T00:00:00Z");
  if (Number.isNaN(date.getTime())) {
    throw new Error("日付を解釈できません: " + value);
  }
  date.setUTCDate(date.getUTCDate() - dayCount);
  return date.toISOString().slice(0, 10);
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
          :href="readyState == null ? loadingHomeHref : routeHref({ name: 'home' }, readyState.result.range)"
          class="font-display text-sm font-semibold tracking-wide"
        >
          VOICEVOX Leaderboard
        </a>
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
                <button
                  type="button"
                  class="font-semibold text-accent hover:underline"
                  @click="setRecentDays(7)"
                >
                  直近 7 日
                </button>
                <button
                  type="button"
                  class="font-semibold text-accent hover:underline"
                  @click="setRecentDays(30)"
                >
                  直近 30 日
                </button>
                <button
                  type="button"
                  class="font-semibold text-accent hover:underline"
                  @click="setAllRange"
                >
                  取得済み全期間
                </button>
              </div>

              <div class="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
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
      <main v-if="appLocation.route.name === 'home'">
        <section class="border-b border-line">
          <div class="mx-auto max-w-7xl px-5 py-12 sm:px-8 lg:py-16">
            <div class="self-center">
              <p class="text-xs font-semibold tracking-[0.2em] text-accent uppercase">
                Precomputed GitHub data
              </p>
              <h1 class="mt-4 max-w-2xl font-display text-4xl leading-[1.15] font-semibold tracking-tight sm:text-5xl">
                貢献の形が違っても、
                <span class="text-accent-dark">一つの成果</span>として測る。
              </h1>
              <p class="mt-6 max-w-xl text-base leading-8 text-muted">
                VOICEVOX の公開かつ非アーカイブな全リポジトリから、関連 Issue、実装、レビュー、調査を一つの点数へ変換します。
                GitHub API の取得と本文解析は事前に完了しています。
              </p>
              <dl class="mt-8 grid max-w-xl grid-cols-3 divide-x divide-line border-y border-line py-4">
                <div class="pr-4">
                  <dt class="text-xs text-muted">
                    リポジトリ
                  </dt>
                  <dd class="mt-1 font-display text-2xl font-semibold">
                    {{ readyState.dataset.repositories.length }}
                  </dd>
                </div>
                <div class="px-4">
                  <dt class="text-xs text-muted">
                    取得済み PR
                  </dt>
                  <dd class="mt-1 font-display text-2xl font-semibold">
                    {{ readyState.dataset.pulls.length }}
                  </dd>
                </div>
                <div class="pl-4">
                  <dt class="text-xs text-muted">
                    取得済み Issue
                  </dt>
                  <dd class="mt-1 font-display text-2xl font-semibold">
                    {{ readyState.dataset.issues.length }}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        <div class="mx-auto max-w-7xl space-y-14 px-5 py-12 sm:px-8 sm:py-16">
          <LeaderboardTable :result="readyState.result" />
          <WorkstreamList :result="readyState.result" />
          <MethodologyPanel :notices="readyState.dataset.notices" />
        </div>
      </main>

      <PersonPage
        v-else-if="appLocation.route.name === 'person' && currentContributor != null"
        :contributor="currentContributor"
        :range="readyState.result.range"
        :result="readyState.result"
      />

      <PullPage
        v-else-if="appLocation.route.name === 'pull' && currentPull != null"
        :pull="currentPull"
        :workstream="currentPullWorkstream"
        :range="readyState.result.range"
      />

      <IssuePage
        v-else-if="appLocation.route.name === 'issue' && currentIssue != null"
        :issue="currentIssue"
        :workstreams="currentIssueWorkstreams"
        :standalone="currentStandaloneIssue"
        :range="readyState.result.range"
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
          :href="routeHref({ name: 'home' }, readyState.result.range)"
          class="mt-6 inline-block font-semibold text-accent hover:underline"
        >
          リーダーボードへ戻る
        </a>
      </main>
    </template>
  </div>
</template>
