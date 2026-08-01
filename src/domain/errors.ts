/** GitHub API が返したエラーを表す。 */
export class GitHubApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
  }
}

/** GitHub API との通信に失敗したことを表す。 */
export class GitHubNetworkError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "GitHubNetworkError";
  }
}

/** GitHub API の応答形式が想定と異なることを表す。 */
export class GitHubResponseValidationError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "GitHubResponseValidationError";
  }
}

/** 到達不能な分岐へ到達したことを表す。 */
export class UnreachableError extends Error {
  constructor(value: never) {
    super("到達不能な分岐へ到達しました: " + String(value));
    this.name = "UnreachableError";
  }
}

/** 値が null または undefined でないことを表明する。 */
export function assertNonNullable<T>(
  value: T,
  message: string,
): asserts value is NonNullable<T> {
  if (value == null) {
    throw new Error(message);
  }
}
