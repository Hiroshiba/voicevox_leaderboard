import { z } from "zod";
import { UnreachableError } from "../domain/errors.ts";
import type { DateRange } from "../domain/model.ts";

export type RelativePeriodUnit = "day" | "week" | "month";

export type RangeSelection =
  | { type: "absolute"; range: DateRange }
  | {
      type: "relative";
      count: number;
      unit: RelativePeriodUnit;
    };

export interface ResolvedRangeSelection {
  selection: RangeSelection;
  range: DateRange;
}

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

const rangeSelectionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("absolute"),
    range: dateRangeSchema,
  }),
  z.object({
    type: z.literal("relative"),
    count: z.coerce.number().int().positive().max(999),
    unit: z.enum(["day", "week", "month"]),
  }),
]);

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

/** 日付指定または直近期間指定を取得済み期間内の日付範囲へ変換する。 */
export function resolveRangeSelection(
  input: unknown,
  availableRange: DateRange,
): ResolvedRangeSelection {
  const parsed = rangeSelectionSchema.safeParse(input);
  if (parsed.success === false) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join("\n"));
  }
  if (parsed.data.type === "absolute") {
    return {
      selection: parsed.data,
      range: parseDateRange(parsed.data.range, availableRange),
    };
  }
  const candidateStart = relativePeriodStart(
    availableRange.end,
    parsed.data.count,
    parsed.data.unit,
  );
  return {
    selection: parsed.data,
    range: {
      start:
        candidateStart < availableRange.start
          ? availableRange.start
          : candidateStart,
      end: availableRange.end,
    },
  };
}

function relativePeriodStart(
  end: string,
  count: number,
  unit: RelativePeriodUnit,
): string {
  switch (unit) {
    case "day":
      return subtractDays(end, count - 1);
    case "week":
      return subtractDays(end, count * 7 - 1);
    case "month":
      return subtractCalendarMonths(end, count);
    default:
      throw new UnreachableError(unit);
  }
}

function subtractDays(value: string, dayCount: number): string {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() - dayCount);
  return formatDate(date);
}

function subtractCalendarMonths(value: string, monthCount: number): string {
  const date = parseDate(value);
  const targetMonth = date.getUTCMonth() - monthCount;
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), targetMonth + 1, 0),
  ).getUTCDate();
  return formatDate(
    new Date(
      Date.UTC(
        date.getUTCFullYear(),
        targetMonth,
        Math.min(date.getUTCDate(), lastDay),
      ),
    ),
  );
}

function parseDate(value: string): Date {
  const parsed = dateSchema.safeParse(value);
  if (parsed.success === false) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join("\n"));
  }
  return new Date(parsed.data + "T00:00:00Z");
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
