import { z } from "zod";
import type { DateRange } from "../domain/model.ts";

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

const dateRangeSchema = z
  .object({
    start: dateSchema,
    end: dateSchema,
  })
  .superRefine((range, context) => {
    if (range.start > range.end) {
      context.addIssue({
        code: "custom",
        path: ["end"],
        message: "終了日は開始日以降にしてください。",
      });
    }
  });

/** 画面入力を取得済み期間内の日付範囲へ変換する。 */
export function parseDateRange(
  input: unknown,
  availableRange: DateRange,
): DateRange {
  const parsed = dateRangeSchema.safeParse(input);
  if (parsed.success === false) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join("\n"));
  }
  if (
    parsed.data.start < availableRange.start ||
    parsed.data.end > availableRange.end
  ) {
    throw new Error(
      "対象期間は取得済みの " +
        availableRange.start +
        " から " +
        availableRange.end +
        " までで指定してください。",
    );
  }
  return parsed.data;
}
