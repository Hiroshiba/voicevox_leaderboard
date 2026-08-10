<script setup lang="ts">
defineProps<{
  notices: string[];
  fullAiRepositories: string[];
}>();
</script>

<template>
  <main class="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
    <header>
      <p class="text-xs font-semibold tracking-[0.18em] text-accent uppercase">
        Calculation methodology
      </p>
      <h1 class="mt-2 font-display text-3xl font-semibold">
        計算式
      </h1>
      <p class="mt-4 max-w-3xl text-sm leading-7 text-muted">
        対象期間に発生した GitHub 上の活動を、次の規則で一つの点数へ変換します。
        PR の状態に応じた配点対象日とレビュー日時、Issue の作成、Close、コメント日時を期間判定に使います。
      </p>
    </header>

    <div class="mt-9 space-y-6">
      <section class="rounded-3xl border border-line bg-surface p-6 sm:p-8">
        <h2 class="font-display text-2xl font-semibold">
          成果のまとめ方と重要度
        </h2>
        <p class="mt-3 text-sm leading-7 text-muted">
          Closing keyword、関連 Issue セクション、関連 PR の順に主 Issue を探します。
          同じ主 Issue を参照するマージ済み PR は一つのワークストリームへまとめます。
          主 Issue がない PR と未マージ PR は単独のワークストリームとして扱います。
        </p>
        <div class="mt-5 rounded-2xl bg-ink px-5 py-4 text-white">
          <p class="overflow-x-auto font-mono text-sm leading-7 whitespace-nowrap">
            I = min { 15, 1 + 1.5 log₂(1 + E / 20) + 0.5 log₂(1 + F) + log₂ R + C }
          </p>
        </div>
        <dl class="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          <div class="rounded-xl bg-paper/70 p-4">
            <dt class="font-semibold">
              E 有効変更行
            </dt>
            <dd class="mt-2 leading-6 text-muted">
              1 ファイル 200 行を上限に、通常ファイルを 1 倍、文章を 0.5 倍、生成物、lockfile、snapshot、vendor を 0.05 倍で数えます。
            </dd>
          </div>
          <div class="rounded-xl bg-paper/70 p-4">
            <dt class="font-semibold">
              F 非生成ファイル数
            </dt>
            <dd class="mt-2 leading-6 text-muted">
              生成物として扱わなかった変更ファイルの合計です。
            </dd>
          </div>
          <div class="rounded-xl bg-paper/70 p-4">
            <dt class="font-semibold">
              R リポジトリ数
            </dt>
            <dd class="mt-2 leading-6 text-muted">
              同じ成果に含まれる PR がまたがったリポジトリ数です。
            </dd>
          </div>
          <div class="rounded-xl bg-paper/70 p-4">
            <dt class="font-semibold">
              C 種別補正
            </dt>
            <dd class="mt-2 leading-6 text-muted">
              破壊的変更とセキュリティ修正は 1.5、feat、fix、perf は 1、style は 0.25、それ以外は 0.5 です。
              複数 PR では最大値を一度だけ使います。
            </dd>
          </div>
        </dl>
        <p class="mt-5 text-sm leading-7 text-muted">
          PR ごとの実装質量は M = 1 + log₂(1 + E / 20) + 0.5 log₂(1 + F) です。
          複数 PR の実装枠と Issue 枠を分ける比率に使います。
        </p>
      </section>

      <section class="rounded-3xl border border-line bg-surface p-6 sm:p-8">
        <h2 class="font-display text-2xl font-semibold">
          PR の状態と未マージ PR
        </h2>
        <p class="mt-3 text-sm leading-7 text-muted">
          PR の状態は選択期間の末日時点で判定します。
          期間末より後にマージまたはクローズされた PR は、その期間ではまだオープンとして扱います。
        </p>
        <dl class="mt-5 grid gap-4 text-sm sm:grid-cols-3">
          <div class="rounded-xl bg-paper/70 p-4">
            <dt class="font-semibold">
              マージ済み 1 倍
            </dt>
            <dd class="mt-2 leading-6 text-muted">
              マージ日を配点対象日にします。
            </dd>
          </div>
          <div class="rounded-xl bg-paper/70 p-4">
            <dt class="font-semibold">
              オープン 0.5 倍
            </dt>
            <dd class="mt-2 leading-6 text-muted">
              作成日を配点対象日にします。
            </dd>
          </div>
          <div class="rounded-xl bg-paper/70 p-4">
            <dt class="font-semibold">
              クローズ済み 0.25 倍
            </dt>
            <dd class="mt-2 leading-6 text-muted">
              クローズ日を配点対象日にします。
            </dd>
          </div>
        </dl>
        <p class="mt-5 text-sm leading-7 text-muted">
          実装枠には状態に応じた係数を掛けます。
          未マージ PR は、作者以外の人間による承認または実質レビューがなければ実装枠を配分しません。
        </p>
        <p class="mt-3 text-sm leading-7 text-muted">
          レビュー枠には状態係数を掛けません。
          レビューの労力はマージ結果に左右されないためです。
        </p>
        <p class="mt-3 text-sm leading-7 text-muted">
          未マージ PR には関連 Issue 枠を配分せず、他の PR ともまとめません。
          関連 Issue は独立 Issue として採点します。
        </p>
      </section>

      <section class="rounded-3xl border border-line bg-surface p-6 sm:p-8">
        <h2 class="font-display text-2xl font-semibold">
          実装、レビュー、Issue への配分
        </h2>
        <div class="mt-5 grid gap-5 lg:grid-cols-3">
          <div>
            <p class="font-semibold text-emerald-800">
              実装 最大 65%
            </p>
            <p class="mt-2 text-sm leading-7 text-muted">
              PR の実装質量に比例して分けます。共同作者がいなければ作者へ全量を配点します。
              共同作者がいる場合は作者へ 70%、共同作者全体へ 30%を配点します。
              マージまでに作者以外の人間による承認、実質レビュー、マージのいずれかがあれば、実装枠を全量配分します。
              独立した品質確認がないマージ済み PR は、実装枠の 50%だけを配分します。
              未マージ PR は実装枠を配分しません。
              フルAI実装リポジトリでは、さらに実装枠の 30%だけを配分します。
            </p>
          </div>
          <div>
            <p class="font-semibold text-blue-800">
              レビュー 20%
            </p>
            <p class="mt-2 text-sm leading-7 text-muted">
              人物ごとに参加 1、実質的な総評 1、実質的なスレッドを最大 3 件まで各 1 として重み付けします。
              重みの合計が 5 未満なら配点枠の一部を未配分にします。
            </p>
          </div>
          <div>
            <p class="font-semibold text-amber-900">
              Issue・調査 15%
            </p>
            <p class="mt-2 text-sm leading-7 text-muted">
              Issue 作成を重み 2、本文の証拠要素を最大 4 件まで各 1 とします。
              実質的コメントは人物ごとに 3 件まで数え、1、0.5、0.25 と逓減します。
              添付、ログ、測定結果があるコメントは各重みを 2 倍にします。
            </p>
          </div>
        </div>
        <div class="mt-5 rounded-2xl bg-ink px-5 py-4 text-white">
          <p class="overflow-x-auto font-mono text-sm leading-7 whitespace-nowrap">
            実装配分枠 = 0.65 I × A × G × T
          </p>
          <p class="mt-1 text-sm leading-6 text-white/70">
            A は独立した品質確認があれば 1、なければマージ済みは 0.5、未マージは 0 です。
            G はフルAI実装リポジトリなら 0.3、それ以外は 1 です。
            T はマージ済みなら 1、オープンなら 0.5、クローズ済みなら 0.25 です。
          </p>
        </div>
        <p class="mt-5 rounded-xl bg-paper/70 p-4 text-sm leading-7 text-muted">
          Bot 作者分、配点対象レビューがない枠、関連 Issue がない枠などは未配分です。
          未配分点は人物の順位へ加えません。
        </p>
        <p class="mt-4 text-sm leading-7 text-muted">
          PR ごとの AI 利用の記載や推定結果は係数に使いません。
          フルAI実装かどうかはリポジトリ単位の設定で扱います。
          独立した人間の品質確認は、どの PR にも同じ条件で適用します。
          Bot レビューは品質確認に数えません。
        </p>
      </section>

      <section class="rounded-3xl border border-line bg-surface p-6 sm:p-8">
        <h2 class="font-display text-2xl font-semibold">
          フルAI実装リポジトリ
        </h2>
        <p class="mt-3 text-sm leading-7 text-muted">
          AI へ実装させる前提で運用しているリポジトリは、設定ファイルで指定します。
          指定したリポジトリの PR は、変更ファイルをすべて生成物として数えます。
          有効変更行 E は 0.05 倍になり、非生成ファイル数 F は 0 になります。
          AI が書いた行数は人間の作業量を表さないためです。
        </p>
        <p class="mt-3 text-sm leading-7 text-muted">
          実装枠は 30%だけを作者と共同作者へ配分し、残りを未配分にします。
          コードを書いたのは AI で、人間の実装側の関与は指示と受け入れに限られるためです。
          レビュー枠と Issue・調査枠の割合は変えません。
          AI が書いたコードを人間が確認する作業は、他のリポジトリと同じ価値があるためです。
        </p>
        <div class="mt-5 rounded-xl bg-paper/70 p-4 text-sm">
          <p class="font-semibold">
            対象リポジトリ
          </p>
          <ul
            v-if="fullAiRepositories.length > 0"
            class="mt-2 space-y-1 font-mono text-xs text-muted"
          >
            <li
              v-for="repository in fullAiRepositories"
              :key="repository"
            >
              {{ repository }}
            </li>
          </ul>
          <p
            v-else
            class="mt-2 leading-6 text-muted"
          >
            フルAI実装として設定したリポジトリはありません。
          </p>
        </div>
      </section>

      <section class="rounded-3xl border border-line bg-surface p-6 sm:p-8">
        <h2 class="font-display text-2xl font-semibold">
          PR にならなかった Issue
        </h2>
        <p class="mt-3 text-sm leading-7 text-muted">
          関連するマージ済み PR がない Issue は、状態、証拠要素、実質的コメント、参加者から独立 Issue スコアを求めます。
          invalid と spam の Issue は除外します。
        </p>
        <div class="mt-5 rounded-2xl bg-ink px-5 py-4 text-white">
          <p class="overflow-x-auto font-mono text-sm leading-7 whitespace-nowrap">
            S = min { 8, B + 0.5 min { K, 4 } + min { 3, log₂(1 + Q) } + min { 1.5, 0.75 log₂(1 + P) } }
          </p>
        </div>
        <dl class="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt class="font-semibold">
              B 状態点
            </dt><dd class="mt-1 leading-6 text-muted">
              完了として Close は 2、根拠がある対応しない Close は 0.5、十分に検証が進んだ Open は 1 です。
            </dd>
          </div>
          <div>
            <dt class="font-semibold">
              K 証拠要素数
            </dt><dd class="mt-1 leading-6 text-muted">
              コード、ログ、コマンド、添付、外部参照、実行環境、測定値を数えます。
            </dd>
          </div>
          <div>
            <dt class="font-semibold">
              Q 実質的コメント数
            </dt><dd class="mt-1 leading-6 text-muted">
              引用とテンプレートを除いて 80 文字以上、または証拠要素があるコメントを数えます。
            </dd>
          </div>
          <div>
            <dt class="font-semibold">
              P 参加者数
            </dt><dd class="mt-1 leading-6 text-muted">
              Issue 作者以外で実質的コメントを投稿した人物を数えます。
            </dd>
          </div>
        </dl>
      </section>

      <section class="rounded-3xl border border-line bg-surface p-6 sm:p-8">
        <h2 class="font-display text-2xl font-semibold">
          判定上の制約
        </h2>
        <ul class="mt-5 space-y-2 text-sm leading-7 text-muted">
          <li
            v-for="notice in notices"
            :key="notice"
          >
            {{ notice }}
          </li>
        </ul>
      </section>
    </div>
  </main>
</template>
