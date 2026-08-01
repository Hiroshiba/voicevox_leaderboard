import { z } from "zod";

export const githubUserSchema = z.object({
  login: z.string().min(1),
  avatar_url: z.string().url(),
  html_url: z.string().url(),
  type: z.string().min(1),
});

const labelSchema = z.object({
  name: z.string(),
});

export const repositorySchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable(),
  archived: z.boolean(),
  fork: z.boolean(),
  mirror_url: z.string().nullable(),
});

export const searchIssuesSchema = z.object({
  total_count: z.number().int().nonnegative(),
  incomplete_results: z.boolean(),
  items: z.array(
    z.object({
      number: z.number().int().positive(),
    }),
  ),
});

export const pullSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullable(),
  html_url: z.string().url(),
  user: githubUserSchema.nullable(),
  merged_at: z.string().datetime().nullable(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  changed_files: z.number().int().nonnegative(),
  labels: z.array(labelSchema),
});

export const pullFileSchema = z.object({
  filename: z.string().min(1),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});

export const pullReviewSchema = z.object({
  user: githubUserSchema.nullable(),
  body: z.string().nullable(),
  state: z.string(),
  submitted_at: z.string().datetime().nullable(),
});

export const reviewCommentSchema = z.object({
  user: githubUserSchema.nullable(),
  body: z.string(),
  created_at: z.string().datetime(),
  in_reply_to_id: z.number().int().positive().nullable().optional(),
});

export const pullCommitSchema = z.object({
  author: githubUserSchema.nullable(),
  commit: z.object({
    message: z.string(),
  }),
});

export const issueSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullable(),
  html_url: z.string().url(),
  user: githubUserSchema.nullable(),
  state: z.enum(["open", "closed"]),
  state_reason: z.string().nullable(),
  created_at: z.string().datetime(),
  closed_at: z.string().datetime().nullable(),
  updated_at: z.string().datetime(),
  labels: z.array(labelSchema),
  pull_request: z
    .object({
      url: z.string().url(),
    })
    .optional(),
});

export const issueCommentSchema = z.object({
  id: z.number().int().positive(),
  body: z.string(),
  html_url: z.string().url(),
  user: githubUserSchema.nullable(),
  created_at: z.string().datetime(),
});

export const apiErrorSchema = z.object({
  message: z.string(),
});

export type GithubUser = z.infer<typeof githubUserSchema>;
export type GithubRepository = z.infer<typeof repositorySchema>;
export type GithubPull = z.infer<typeof pullSchema>;
export type GithubPullFile = z.infer<typeof pullFileSchema>;
export type GithubPullReview = z.infer<typeof pullReviewSchema>;
export type GithubReviewComment = z.infer<typeof reviewCommentSchema>;
export type GithubPullCommit = z.infer<typeof pullCommitSchema>;
export type GithubIssue = z.infer<typeof issueSchema>;
export type GithubIssueComment = z.infer<typeof issueCommentSchema>;
