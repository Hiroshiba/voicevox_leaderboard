import { describe, expect, it } from "vitest";
import { isAutomatedAccountLogin } from "../src/domain/actors";

describe("isAutomatedAccountLogin", () => {
  it.each([
    "dependabot[bot]",
    "release-bot",
    "Copilot",
    "claude",
    "copilot-swe-agent",
  ])("%s を自動化アカウントとして扱う", (login) => {
    expect(isAutomatedAccountLogin(login)).toBe(true);
  });

  it.each(["Hiroshiba", "robotics-user", "botanical"])(
    "%s を人間のアカウントとして扱う",
    (login) => {
      expect(isAutomatedAccountLogin(login)).toBe(false);
    },
  );
});
