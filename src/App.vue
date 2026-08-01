<script setup lang="ts">
import { computed, ref } from "vue";
import LeaderboardTable from "./components/LeaderboardTable.vue";
import MethodologyPanel from "./components/MethodologyPanel.vue";
import WorkstreamList from "./components/WorkstreamList.vue";
import type {
  CalculationProgress,
  LeaderboardResult,
  RepositoryOption,
} from "./domain/model";
import {
  calculateLeaderboard,
  fetchRepositoryOptions,
} from "./services/calculateLeaderboard";
import { parseCalculationScope } from "./services/calculationScope";

const recommendedRepositories = [
  "voicevox",
  "voicevox_engine",
  "voicevox_core",
  "voicevox_project",
  "voicevox_blog",
  "onnxruntime-builder",
  "voicevox_additional_libraries",
];

const initialRange = monthRange(-1);
const environmentToken = import.meta.env.VITE_GITHUB_TOKEN;
const organization = ref("VOICEVOX");
const startDate = ref(initialRange.start);
const endDate = ref(initialRange.end);
const token = ref(environmentToken ?? "");
const selectedRepositoryNames = ref<string[]>([...recommendedRepositories]);
const repositoryOptions = ref<RepositoryOption[]>([]);
const repositoryQuery = ref("");
const customRepository = ref("");
const repositoryMessage = ref("");
const errorMessage = ref("");
const result = ref<LeaderboardResult>();
const progress = ref<CalculationProgress>();
const isLoadingRepositories = ref(false);
const isCalculating = ref(false);

const hasEnvironmentToken =
  environmentToken != null && environmentToken !== "";

const filteredRepositoryOptions = computed<RepositoryOption[]>(() => {
  const query = repositoryQuery.value.trim().toLowerCase();
  if (query === "") {
    return repositoryOptions.value;
  }
  return repositoryOptions.value.filter(
    (repository) =>
      repository.name.toLowerCase().includes(query) ||
      repository.description.toLowerCase().includes(query),
  );
});

const progressPercent = computed<number>(() => {
  if (progress.value == null || progress.value.total === 0) {
    return 0;
  }
  return Math.round(
    (progress.value.completed / progress.value.total) * 100,
  );
});

async function loadRepositories(): Promise<void> {
  errorMessage.value = "";
  repositoryMessage.value = "";
  const normalizedOrganization = organization.value.trim();
  if (
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(
      normalizedOrganization,
    ) === false
  ) {
    errorMessage.value = "Organization の形式が正しくありません。";
    return;
  }

  isLoadingRepositories.value = true;
  try {
    const repositories = await fetchRepositoryOptions(
      normalizedOrganization,
      token.value,
    );
    repositoryOptions.value = repositories;
    repositoryMessage.value =
      repositories.length + " 件のリポジトリを取得しました。";
  } catch (error) {
    console.error("リポジトリ一覧の取得に失敗しました", error);
    errorMessage.value = describeError(error);
  } finally {
    isLoadingRepositories.value = false;
  }
}

function addCustomRepository(): void {
  const name = customRepository.value.trim();
  if (/^[A-Za-z0-9_.-]+$/.test(name) === false) {
    repositoryMessage.value =
      "リポジトリ名だけを入力してください。owner は Organization 欄を使います。";
    return;
  }
  if (selectedRepositoryNames.value.includes(name) === false) {
    selectedRepositoryNames.value.push(name);
  }
  customRepository.value = "";
  repositoryMessage.value = "";
}

function removeRepository(name: string): void {
  selectedRepositoryNames.value = selectedRepositoryNames.value.filter(
    (repository) => repository !== name,
  );
}

function selectAllActiveRepositories(): void {
  selectedRepositoryNames.value = repositoryOptions.value
    .filter(
      (repository) =>
        repository.archived === false && repository.fork === false,
    )
    .map((repository) => repository.name);
}

function selectRecommendedRepositories(): void {
  selectedRepositoryNames.value = [...recommendedRepositories];
}

function clearRepositories(): void {
  selectedRepositoryNames.value = [];
}

function setMonth(offset: number): void {
  const range = monthRange(offset);
  startDate.value = range.start;
  endDate.value = range.end;
}

async function runCalculation(): Promise<void> {
  errorMessage.value = "";
  progress.value = undefined;
  const repositoryNames = [...new Set(selectedRepositoryNames.value)];
  let scope;
  try {
    scope = parseCalculationScope({
      organization: organization.value,
      repositories: repositoryNames.map(
        (repository) => organization.value.trim() + "/" + repository,
      ),
      range: {
        start: startDate.value,
        end: endDate.value,
      },
    });
  } catch (error) {
    errorMessage.value = describeError(error);
    return;
  }

  isCalculating.value = true;
  try {
    result.value = await calculateLeaderboard(
      scope,
      token.value,
      (nextProgress) => {
        progress.value = nextProgress;
      },
    );
  } catch (error) {
    console.error("リーダーボードの計算に失敗しました", error);
    errorMessage.value = describeError(error);
  } finally {
    isCalculating.value = false;
  }
}

function monthRange(offset: number): { start: string; end: string } {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const isCurrentMonth = offset === 0;
  const lastDay = isCurrentMonth
    ? now
    : new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return {
    start: formatLocalDate(firstDay),
    end: formatLocalDate(lastDay),
  };
}

function formatLocalDate(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  console.error("Error 以外の値が投げられました", error);
  return "想定外のエラーが発生しました。開発者ツールのコンソールを確認してください。";
}
</script>

<template>
  <div class="min-h-screen overflow-hidden">
    <header class="border-b border-line bg-surface">
      <div class="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <a
          href="#"
          class="font-display text-sm font-semibold tracking-wide"
        >
          VOICEVOX Contribution Score
        </a>
        <span class="rounded-full border border-accent/30 bg-accent-soft px-3 py-1 text-xs font-semibold text-accent-dark">
          Prototype
        </span>
      </div>
    </header>

    <main>
      <section class="relative border-b border-line">
        <div class="mx-auto grid max-w-7xl gap-10 px-5 py-12 sm:px-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(28rem,1.1fr)] lg:py-16">
          <div class="self-center">
            <p class="text-xs font-semibold tracking-[0.2em] text-accent uppercase">
              Live GitHub calculation
            </p>
            <h1 class="mt-4 max-w-2xl font-display text-4xl leading-[1.15] font-semibold tracking-tight sm:text-5xl">
              貢献の形が違っても、
              <span class="text-accent-dark">一つの成果</span>として測る。
            </h1>
            <p class="mt-6 max-w-xl text-base leading-8 text-muted">
              関連 Issue ごとにマージ済み PR をまとめ、実装、レビュー、調査を一つの
              VOICEVOX Contribution Score へ変換します。すべてブラウザ内で計算し、
              入力したトークンは保存しません。
            </p>

            <dl class="mt-8 grid max-w-lg grid-cols-3 divide-x divide-line border-y border-line py-4">
              <div class="pr-4">
                <dt class="text-xs text-muted">
                  実装枠
                </dt>
                <dd class="mt-1 font-display text-2xl font-semibold">
                  65%
                </dd>
              </div>
              <div class="px-4">
                <dt class="text-xs text-muted">
                  レビュー枠
                </dt>
                <dd class="mt-1 font-display text-2xl font-semibold">
                  20%
                </dd>
              </div>
              <div class="pl-4">
                <dt class="text-xs text-muted">
                  Issue 枠
                </dt>
                <dd class="mt-1 font-display text-2xl font-semibold">
                  15%
                </dd>
              </div>
            </dl>
          </div>

          <form
            class="rounded-3xl border border-line bg-surface p-5 shadow-[0_18px_60px_rgba(34,52,45,0.08)] sm:p-7"
            @submit.prevent="runCalculation"
          >
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-xs font-semibold tracking-wide text-muted uppercase">
                  Target scope
                </p>
                <h2 class="mt-1 font-display text-xl font-semibold">
                  計算対象
                </h2>
              </div>
              <span class="text-xs text-muted">{{ selectedRepositoryNames.length }} repos</span>
            </div>

            <div class="mt-6 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
              <label class="block">
                <span class="text-sm font-semibold">Organization</span>
                <input
                  v-model="organization"
                  type="text"
                  autocomplete="off"
                  required
                  class="mt-2 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm"
                >
              </label>
              <button
                type="button"
                :disabled="isLoadingRepositories || isCalculating"
                class="self-end rounded-xl border border-line px-4 py-2.5 text-sm font-semibold hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                @click="loadRepositories"
              >
                <span
                  v-if="isLoadingRepositories"
                  class="mr-2 inline-block size-3 animate-spin rounded-full border-2 border-line border-t-accent"
                />
                候補を取得
              </button>
            </div>

            <fieldset class="mt-5">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <legend class="text-sm font-semibold">
                  対象リポジトリ
                </legend>
                <div class="flex gap-3 text-xs">
                  <button
                    v-if="repositoryOptions.length > 0"
                    type="button"
                    class="text-accent hover:underline"
                    @click="selectAllActiveRepositories"
                  >
                    有効な候補を全選択
                  </button>
                  <button
                    v-if="organization.toLowerCase() === 'voicevox'"
                    type="button"
                    class="text-accent hover:underline"
                    @click="selectRecommendedRepositories"
                  >
                    推奨範囲
                  </button>
                  <button
                    type="button"
                    class="text-muted hover:underline"
                    @click="clearRepositories"
                  >
                    解除
                  </button>
                </div>
              </div>

              <div class="mt-2 flex min-h-12 flex-wrap gap-2 rounded-xl border border-line bg-paper/50 p-2">
                <span
                  v-for="repository in selectedRepositoryNames"
                  :key="repository"
                  class="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-xs font-medium shadow-sm"
                >
                  {{ repository }}
                  <button
                    type="button"
                    :aria-label="repository + ' を対象から外す'"
                    class="text-muted hover:text-danger"
                    @click="removeRepository(repository)"
                  >
                    ×
                  </button>
                </span>
                <span
                  v-if="selectedRepositoryNames.length === 0"
                  class="self-center px-2 text-xs text-muted"
                >
                  リポジトリを追加してください
                </span>
              </div>

              <div class="mt-2 flex gap-2">
                <input
                  v-model="customRepository"
                  type="text"
                  autocomplete="off"
                  placeholder="リポジトリ名を直接追加"
                  class="min-w-0 flex-1 rounded-xl border border-line bg-white px-3.5 py-2 text-sm"
                  @keydown.enter.prevent="addCustomRepository"
                >
                <button
                  type="button"
                  class="rounded-xl border border-line px-4 py-2 text-sm font-semibold hover:border-accent hover:text-accent"
                  @click="addCustomRepository"
                >
                  追加
                </button>
              </div>

              <div
                v-if="repositoryOptions.length > 0"
                class="mt-3 rounded-xl border border-line bg-white p-3"
              >
                <input
                  v-model="repositoryQuery"
                  type="search"
                  placeholder="候補を絞り込み"
                  class="w-full rounded-lg border border-line px-3 py-2 text-sm"
                >
                <div class="mt-2 max-h-44 overflow-y-auto">
                  <label
                    v-for="repository in filteredRepositoryOptions"
                    :key="repository.name"
                    class="flex items-start gap-3 border-b border-line/70 py-2 last:border-b-0"
                    :class="repository.archived || repository.fork ? 'text-muted' : 'cursor-pointer'"
                  >
                    <input
                      v-model="selectedRepositoryNames"
                      type="checkbox"
                      :value="repository.name"
                      :disabled="repository.archived || repository.fork"
                      class="mt-1 accent-accent"
                    >
                    <span class="min-w-0">
                      <span class="text-sm font-medium">{{ repository.name }}</span>
                      <span
                        v-if="repository.archived"
                        class="ml-2 text-xs"
                      >アーカイブ</span>
                      <span
                        v-if="repository.fork"
                        class="ml-2 text-xs"
                      >fork または mirror</span>
                      <span
                        v-if="repository.description !== ''"
                        class="block truncate text-xs text-muted"
                      >
                        {{ repository.description }}
                      </span>
                    </span>
                  </label>
                </div>
              </div>
              <p
                v-if="repositoryMessage !== ''"
                class="mt-2 text-xs text-muted"
              >
                {{ repositoryMessage }}
              </p>
            </fieldset>

            <fieldset class="mt-5">
              <div class="flex items-center justify-between gap-3">
                <legend class="text-sm font-semibold">
                  対象期間
                </legend>
                <div class="flex gap-3 text-xs">
                  <button
                    type="button"
                    class="text-accent hover:underline"
                    @click="setMonth(-1)"
                  >
                    前月
                  </button>
                  <button
                    type="button"
                    class="text-accent hover:underline"
                    @click="setMonth(0)"
                  >
                    今月
                  </button>
                </div>
              </div>
              <div class="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <input
                  v-model="startDate"
                  type="date"
                  required
                  class="min-w-0 rounded-xl border border-line bg-white px-3 py-2.5 text-sm"
                >
                <span class="text-muted">—</span>
                <input
                  v-model="endDate"
                  type="date"
                  required
                  class="min-w-0 rounded-xl border border-line bg-white px-3 py-2.5 text-sm"
                >
              </div>
            </fieldset>

            <label class="mt-5 block">
              <span class="flex items-center justify-between gap-2 text-sm font-semibold">
                GitHub token
                <span
                  v-if="hasEnvironmentToken"
                  class="rounded-full bg-accent-soft px-2 py-0.5 text-[0.68rem] text-accent-dark"
                >
                  環境変数から読込済み
                </span>
              </span>
              <input
                v-model="token"
                type="password"
                autocomplete="off"
                placeholder="未入力でも公開 API を利用できます"
                class="mt-2 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm"
              >
              <span class="mt-1.5 block text-xs leading-5 text-muted">
                トークンはブラウザのメモリ内だけで使用します。未入力時の API 上限は低いため、
                通常は読み取り権限だけの fine-grained token を使用してください。
              </span>
            </label>

            <button
              type="submit"
              :disabled="isCalculating || isLoadingRepositories"
              class="mt-6 flex w-full items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span
                v-if="isCalculating"
                class="mr-2 inline-block size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
              />
              {{ isCalculating ? "GitHub から取得中" : "実データで計算する" }}
            </button>
          </form>
        </div>
      </section>

      <div class="mx-auto max-w-7xl px-5 py-10 sm:px-8">
        <div
          v-if="errorMessage !== ''"
          role="alert"
          class="mb-8 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm leading-6 text-danger"
        >
          <p class="font-semibold">
            計算を完了できませんでした
          </p>
          <p class="mt-1 whitespace-pre-line">
            {{ errorMessage }}
          </p>
        </div>

        <div
          v-if="isCalculating && progress != null"
          class="mb-8 rounded-2xl border border-line bg-surface p-5"
          aria-live="polite"
        >
          <div class="flex justify-between gap-4 text-sm">
            <span class="font-semibold">{{ progress.message }}</span>
            <span class="font-mono text-muted">{{ progress.completed }} / {{ progress.total }}</span>
          </div>
          <div class="mt-3 h-2 overflow-hidden rounded-full bg-line">
            <div
              class="h-full rounded-full bg-accent"
              :style="{ width: progressPercent + '%' }"
            />
          </div>
          <p class="mt-2 text-xs text-muted">
            選択範囲によっては数分かかります。このタブを開いたままお待ちください。
          </p>
        </div>

        <template v-if="result != null">
          <section
            aria-label="計算概要"
            class="mb-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <div class="rounded-2xl border border-line bg-surface p-4">
              <p class="text-xs text-muted">
                貢献者
              </p>
              <p class="mt-1 font-display text-2xl font-semibold">
                {{ result.contributors.length }}
              </p>
            </div>
            <div class="rounded-2xl border border-line bg-surface p-4">
              <p class="text-xs text-muted">
                ワークストリーム
              </p>
              <p class="mt-1 font-display text-2xl font-semibold">
                {{ result.workstreams.length }}
              </p>
            </div>
            <div class="rounded-2xl border border-line bg-surface p-4">
              <p class="text-xs text-muted">
                独立 Issue
              </p>
              <p class="mt-1 font-display text-2xl font-semibold">
                {{ result.standaloneIssues.length }}
              </p>
            </div>
            <div class="rounded-2xl border border-line bg-surface p-4">
              <p class="text-xs text-muted">
                GitHub API
              </p>
              <p class="mt-1 font-display text-2xl font-semibold">
                {{ result.requestCount }} requests
              </p>
              <p
                v-if="result.rateLimit != null"
                class="mt-1 text-[0.68rem] text-muted"
              >
                最終 API 区分の残り {{ result.rateLimit.remaining }} /
                {{ result.rateLimit.limit }} ・
                {{ formatDateTime(result.rateLimit.resetsAt) }} リセット
              </p>
            </div>
          </section>

          <LeaderboardTable :result="result" />
          <div class="my-14 border-t border-line" />
          <WorkstreamList :result="result" />
          <div class="mt-14">
            <MethodologyPanel :notices="result.notices" />
          </div>
        </template>

        <section
          v-else-if="isCalculating === false"
          class="rounded-3xl border border-dashed border-line px-6 py-14 text-center"
        >
          <p class="font-display text-xl font-semibold">
            まだ計算結果はありません
          </p>
          <p class="mt-2 text-sm text-muted">
            上の対象範囲を確認して、実データで計算してください。
          </p>
        </section>
      </div>
    </main>

    <footer class="border-t border-line px-5 py-6 text-center text-xs text-muted">
      GitHub 上で観測できる活動だけを対象にした検証用プロトタイプです。
    </footer>
  </div>
</template>
