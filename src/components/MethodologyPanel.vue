<script setup lang="ts">
defineProps<{
  notices: string[];
}>();
</script>

<template>
  <section
    aria-labelledby="method-heading"
    class="rounded-3xl bg-ink px-6 py-8 text-white sm:px-8"
  >
    <p class="mb-1 text-xs font-semibold tracking-[0.18em] text-emerald-300 uppercase">
      Prototype methodology
    </p>
    <h2
      id="method-heading"
      class="font-display text-2xl font-semibold"
    >
      この試算で行うこと
    </h2>

    <div class="mt-6 grid gap-6 lg:grid-cols-3">
      <div>
        <p class="text-sm font-semibold text-emerald-300">
          1. 成果をまとめる
        </p>
        <p class="mt-2 text-sm leading-7 text-white/75">
          Closing keyword、関連 Issue セクション、関連 PR の順に主 Issue を探し、
          同じ Issue を参照するマージ済み PR を一つのワークストリームにします。
        </p>
      </div>
      <div>
        <p class="text-sm font-semibold text-emerald-300">
          2. 重要度を求める
        </p>
        <p class="mt-2 text-sm leading-7 text-white/75">
          有効変更行 E、非生成ファイル F、リポジトリ数 R、Conventional
          Commits 補正 C を対数評価します。重要度の上限は 15 です。
        </p>
      </div>
      <div>
        <p class="text-sm font-semibold text-emerald-300">
          3. 成果を配分する
        </p>
        <p class="mt-2 text-sm leading-7 text-white/75">
          重要度を実装 65%、人間レビュー 20%、Issue と調査 15%へ配分します。
          未使用枠は実装者へ戻しません。Bot の活動は配点しません。
        </p>
      </div>
    </div>

    <div class="mt-7 rounded-2xl border border-white/15 bg-white/5 p-4">
      <p class="font-mono text-sm leading-7 text-white/90">
        I = min { 15, 1 + 1.5 log₂(1 + E / 20) + 0.5 log₂(1 + F) + log₂ R + C }
      </p>
      <p class="mt-2 text-xs leading-6 text-white/60">
        1 ファイルの変更は 200 行までです。文章ファイルは 0.5 倍、生成物、
        lockfile、snapshot、vendor は 0.05 倍で数えます。
      </p>
    </div>

    <details class="mt-6 rounded-2xl border border-white/15 px-4 py-3">
      <summary class="cursor-pointer list-none text-sm font-semibold">
        プロトタイプの判定規則と制約
        <span
          aria-hidden="true"
          class="ml-2 text-white/50"
        >⌄</span>
      </summary>
      <ul class="mt-3 space-y-2 text-xs leading-6 text-white/65">
        <li>
          Issue コメントは引用とテンプレートを除いて 80 文字以上、または証拠要素が
          1 種以上ある場合に実質的と判定します。
        </li>
        <li>
          レビュー本文は定型的な承認を除いて 20 文字以上、または証拠要素が
          1 種以上ある場合に実質的と判定します。
        </li>
        <li
          v-for="notice in notices"
          :key="notice"
        >
          {{ notice }}
        </li>
      </ul>
    </details>
  </section>
</template>
