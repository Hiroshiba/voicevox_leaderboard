const automatedAccountLogins = new Set([
  "claude",
  "copilot",
  "copilot-pull-request-reviewer",
  "copilot-swe-agent",
]);

/** GitHub ログインが Bot または AI エージェントを表すか判定する。 */
export function isAutomatedAccountLogin(login: string): boolean {
  return (
    automatedAccountLogins.has(login.toLowerCase()) ||
    /\[bot\]$|(?:^|[-_])bot$/i.test(login)
  );
}
