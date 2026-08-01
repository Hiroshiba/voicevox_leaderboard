import { z } from "zod";
import { assertNonNullable } from "../domain/errors.ts";
import type {
  DateRange,
  SourceReference,
} from "../domain/model.ts";

export type AppRoute =
  | { name: "home" }
  | { name: "pulls" }
  | { name: "issues" }
  | { name: "methodology" }
  | { name: "person"; login: string }
  | { name: "pull"; key: string }
  | { name: "issue"; key: string }
  | { name: "notFound" };

export interface AppLocation {
  route: AppRoute;
  range?: DateRange | undefined;
}

const loginSchema = z.string().regex(/^[A-Za-z0-9-]+$/);
const ownerSchema = z.string().regex(/^[A-Za-z0-9_.-]+$/);
const repositorySchema = z.string().regex(/^[A-Za-z0-9_.-]+$/);
const numberSchema = z.coerce.number().int().positive();
const rangeSchema = z.object({
  start: z.iso.date(),
  end: z.iso.date(),
});
const applicationBasePath = normalizeBasePath(import.meta.env.BASE_URL);

/** URL を画面ルートと期間へ変換する。 */
export function parseAppLocation(location: string): AppLocation {
  let url: URL;
  try {
    url = new URL(location, "https://leaderboard.invalid");
  } catch {
    return { route: { name: "notFound" } };
  }
  if (url.hash.startsWith("#/")) {
    try {
      url = new URL(url.hash.slice(1), "https://leaderboard.invalid");
    } catch (error) {
      throw new Error("旧形式の URL を解釈できません。", { cause: error });
    }
  }
  const appPath = removeApplicationBasePath(url.pathname);
  if (appPath == null) {
    return { route: { name: "notFound" } };
  }
  const segments = appPath
    .split("/")
    .filter((segment) => segment !== "")
    .map(decodeSegment);
  const route = parseRouteSegments(segments);
  const parsedRange = rangeSchema.safeParse({
    start: url.searchParams.get("start"),
    end: url.searchParams.get("end"),
  });
  return {
    route,
    ...(parsedRange.success ? { range: parsedRange.data } : {}),
  };
}

/** 画面ルートと期間からリンクを作る。 */
export function routeHref(route: AppRoute, range: DateRange): string {
  const query = new URLSearchParams({
    start: range.start,
    end: range.end,
  });
  return applicationPath(routePath(route)) + "?" + query.toString();
}

/** 点数の発生源から詳細ページのリンクを作る。 */
export function sourceHref(
  source: SourceReference,
  range: DateRange,
): string {
  return routeHref(
    {
      name: source.type,
      key: source.key,
    },
    range,
  );
}

/** GitHub の項目キーを正規化する。 */
export function createEntityKey(
  repository: string,
  number: number,
): string {
  return repository.toLowerCase() + "#" + number;
}

/** パスがこのアプリケーション内を指すか判定する。 */
export function isApplicationPath(pathname: string): boolean {
  return removeApplicationBasePath(pathname) != null;
}

function parseRouteSegments(segments: string[]): AppRoute {
  if (segments.length === 0) {
    return { name: "home" };
  }
  if (segments.length === 1 && segments[0] === "pulls") {
    return { name: "pulls" };
  }
  if (segments.length === 1 && segments[0] === "issues") {
    return { name: "issues" };
  }
  if (segments.length === 1 && segments[0] === "methodology") {
    return { name: "methodology" };
  }
  if (segments.length === 2 && segments[0] === "people") {
    const login = loginSchema.safeParse(segments[1]);
    return login.success
      ? { name: "person", login: login.data }
      : { name: "notFound" };
  }
  if (
    segments.length === 4 &&
    (segments[0] === "pulls" || segments[0] === "issues")
  ) {
    const entity = z
      .object({
        owner: ownerSchema,
        repository: repositorySchema,
        number: numberSchema,
      })
      .safeParse({
        owner: segments[1],
        repository: segments[2],
        number: segments[3],
      });
    if (entity.success === false) {
      return { name: "notFound" };
    }
    const key = createEntityKey(
      entity.data.owner + "/" + entity.data.repository,
      entity.data.number,
    );
    return {
      name: segments[0] === "pulls" ? "pull" : "issue",
      key,
    };
  }
  return { name: "notFound" };
}

function routePath(route: AppRoute): string {
  switch (route.name) {
    case "home":
      return "/";
    case "pulls":
      return "/pulls";
    case "issues":
      return "/issues";
    case "methodology":
      return "/methodology";
    case "person":
      return "/people/" + encodeURIComponent(route.login);
    case "pull":
      return entityPath("pulls", route.key);
    case "issue":
      return entityPath("issues", route.key);
    case "notFound":
      return "/not-found";
  }
}

function entityPath(type: "pulls" | "issues", key: string): string {
  const match = /^([^/]+)\/([^#]+)#([1-9]\d*)$/.exec(key);
  const owner = match?.[1];
  const repository = match?.[2];
  const number = match?.[3];
  assertNonNullable(owner, "項目キーに owner がありません。");
  assertNonNullable(repository, "項目キーにリポジトリ名がありません。");
  assertNonNullable(number, "項目キーに番号がありません。");
  return (
    "/" +
    type +
    "/" +
    encodeURIComponent(owner) +
    "/" +
    encodeURIComponent(repository) +
    "/" +
    number
  );
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function normalizeBasePath(value: string): string {
  const url = new URL(value, "https://leaderboard.invalid/");
  const pathname = url.pathname;
  return pathname.endsWith("/") ? pathname : pathname + "/";
}

function removeApplicationBasePath(pathname: string): string | undefined {
  const baseWithoutTrailingSlash = applicationBasePath.slice(0, -1);
  if (pathname === baseWithoutTrailingSlash) {
    return "/";
  }
  if (pathname.startsWith(applicationBasePath) === false) {
    return undefined;
  }
  return "/" + pathname.slice(applicationBasePath.length);
}

function applicationPath(path: string): string {
  if (path === "/") {
    return applicationBasePath;
  }
  return applicationBasePath.slice(0, -1) + path;
}
