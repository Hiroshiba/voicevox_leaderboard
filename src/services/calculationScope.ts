import { z } from "zod";
import type { CalculationScope } from "../domain/model";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日付は YYYY-MM-DD 形式で指定してください。")
  .refine(
    (value) => {
      const date = new Date(value + "T00:00:00Z");
      return (
        Number.isNaN(date.getTime()) === false &&
        date.toISOString().slice(0, 10) === value
      );
    },
    "実在する日付を指定してください。",
  );

const calculationScopeSchema = z
  .object({
    organization: z
      .string()
      .trim()
      .min(1, "Organization を入力してください。")
      .regex(
        /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/,
        "Organization の形式が正しくありません。",
      ),
    repositories: z
      .array(
        z
          .string()
          .regex(
            /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
            "リポジトリ名は owner/name 形式で指定してください。",
          ),
      )
      .min(1, "対象リポジトリを 1 件以上選択してください。"),
    range: z.object({
      start: dateSchema,
      end: dateSchema,
    }),
  })
  .superRefine((scope, context) => {
    if (scope.range.start > scope.range.end) {
      context.addIssue({
        code: "custom",
        path: ["range", "end"],
        message: "終了日は開始日以降にしてください。",
      });
    }
    const expectedOwner = scope.organization.toLowerCase() + "/";
    for (const repository of scope.repositories) {
      if (repository.toLowerCase().startsWith(expectedOwner) === false) {
        context.addIssue({
          code: "custom",
          path: ["repositories"],
          message:
            "対象リポジトリは指定した Organization 内から選択してください。",
        });
        break;
      }
    }
  });

/** 画面入力を検証済みの計算対象へ変換する。 */
export function parseCalculationScope(input: unknown): CalculationScope {
  const parsed = calculationScopeSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join("\n"));
  }
  return {
    organization: parsed.data.organization,
    repositories: uniqueRepositories(parsed.data.repositories),
    range: parsed.data.range,
  };
}

function uniqueRepositories(repositories: string[]): string[] {
  const seen = new Set<string>();
  return repositories.filter((repository) => {
    const key = repository.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
