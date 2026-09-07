import { z } from "zod";
import type { LeaderboardDataset } from "./model.ts";

const dateSchema = z.iso.date();
const dateTimeSchema = z.iso.datetime({ offset: true });

const actorSchema = z.object({
  login: z.string().min(1),
  avatarUrl: z.string().url(),
});

const evidenceKindSchema = z.enum([
  "codeOrLog",
  "command",
  "attachment",
  "reference",
  "environment",
  "measurement",
]);

const editGroupSchema = z.object({
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  beforeTokens: z.number().int().nonnegative(),
  afterTokens: z.number().int().nonnegative(),
  occurrences: z.number().int().positive(),
  weight: z.union([z.literal(0.5), z.literal(1)]),
});

const fileScoreSchema = z.object({
  filename: z.string().min(1),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  previousFilename: z.string().min(1).optional(),
  sha: z.string().min(1).optional(),
  analysis: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("measured"),
      groups: z.array(editGroupSchema),
    }),
    z.object({
      kind: z.literal("generated"),
    }),
    z.object({
      kind: z.literal("unmeasured"),
      reason: z.enum([
        "patchMissing",
        "patchTruncated",
        "binary",
        "unsupported",
      ]),
    }),
  ]),
});

const preparedPullSchema = z.object({
  key: z.string().min(1),
  repository: z.string().min(3),
  number: z.number().int().positive(),
  title: z.string(),
  githubUrl: z.string().url(),
  createdAt: dateTimeSchema,
  outcome: z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("merged"),
        mergedAt: dateTimeSchema,
        mergedBy: actorSchema,
        mergedByIsHuman: z.boolean(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("closed"),
        closedAt: dateTimeSchema,
      })
      .strict(),
    z.object({ kind: z.literal("open") }).strict(),
  ]),
  author: actorSchema,
  authorIsHuman: z.boolean(),
  coauthors: z.array(actorSchema),
  files: z.array(fileScoreSchema),
  conventionalBonus: z.number().nonnegative(),
  fullAiImplementation: z.boolean(),
  reviews: z.array(
    z.object({
      actor: actorSchema,
      submittedAt: dateTimeSchema,
      state: z.enum(["APPROVED", "CHANGES_REQUESTED", "COMMENTED"]),
      hasSubstantiveSummary: z.boolean(),
    }),
  ),
  reviewThreads: z.array(
    z.object({
      actor: actorSchema,
      createdAt: dateTimeSchema,
    }),
  ),
  issueKey: z.string().min(1).optional(),
});

const preparedIssueSchema = z.object({
  key: z.string().min(1),
  repository: z.string().min(3),
  number: z.number().int().positive(),
  title: z.string(),
  githubUrl: z.string().url(),
  author: actorSchema.optional(),
  authorIsHuman: z.boolean(),
  state: z.enum(["open", "closed"]),
  stateReason: z.string().min(1).optional(),
  createdAt: dateTimeSchema,
  closedAt: dateTimeSchema.optional(),
  labels: z.array(z.string()),
  bodyEvidenceKinds: z.array(evidenceKindSchema),
  comments: z.array(
    z.object({
      actor: actorSchema.optional(),
      createdAt: dateTimeSchema,
      substantive: z.boolean(),
      evidenceKinds: z.array(evidenceKindSchema),
    }),
  ),
  activityCandidate: z.boolean(),
});

export const leaderboardDatasetSchema = z.object({
  schemaVersion: z.literal(5),
  organization: z.literal("VOICEVOX"),
  generatedAt: dateTimeSchema,
  range: z.object({
    start: dateSchema,
    end: dateSchema,
  }),
  repositories: z.array(
    z.object({
      nameWithOwner: z.string().min(3),
      fork: z.boolean(),
      mirror: z.boolean(),
      fullAiImplementation: z.boolean(),
    }),
  ),
  pulls: z.array(preparedPullSchema),
  issues: z.array(preparedIssueSchema),
  notices: z.array(z.string().min(1)),
  acquisition: z.object({
    networkRequests: z.number().int().nonnegative(),
    cacheRevalidations: z.number().int().nonnegative(),
    notModifiedResponses: z.number().int().nonnegative(),
    remainingCoreRequests: z.number().int().nonnegative().optional(),
    remainingSearchRequests: z.number().int().nonnegative().optional(),
  }),
}) satisfies z.ZodType<LeaderboardDataset>;

/** JSON を検証して事前取得データへ変換する。 */
export function parseLeaderboardDataset(value: unknown): LeaderboardDataset {
  return leaderboardDatasetSchema.parse(value);
}
