import { z } from "zod";

const fullAiRepositoriesSchema = z.array(
  z
    .string()
    .regex(/^[^\s/]+\/[^\s/]+$/, "リポジトリは owner/name 形式で指定してください。"),
);

/** フルAI実装リポジトリ設定を検証して照合用の集合へ変換する。 */
export function parseFullAiRepositories(value: unknown): Set<string> {
  const names = fullAiRepositoriesSchema.parse(value);
  const keys = new Set(names.map((name) => name.toLowerCase()));
  if (keys.size !== names.length) {
    throw new Error("フルAI実装リポジトリ設定にリポジトリの重複があります。");
  }
  return keys;
}

/** リポジトリがフルAI実装として設定されているか判定する。 */
export function isFullAiRepository(
  fullAiRepositories: Set<string>,
  repository: string,
): boolean {
  return fullAiRepositories.has(repository.toLowerCase());
}
