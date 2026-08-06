import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  isFullAiRepository,
  parseFullAiRepositories,
} from "../src/domain/fullAiRepositories";

describe("parseFullAiRepositories", () => {
  it("大文字小文字を無視してリポジトリを判定する", () => {
    const repositories = parseFullAiRepositories([
      "VOICEVOX/voicevox_task_tracker",
    ]);

    expect(isFullAiRepository(repositories, "voicevox/VOICEVOX_TASK_TRACKER")).toBe(
      true,
    );
    expect(isFullAiRepository(repositories, "VOICEVOX/voicevox")).toBe(false);
  });

  it("owner/name 形式でない設定を拒否する", () => {
    expect(() => parseFullAiRepositories(["voicevox_task_tracker"])).toThrow();
    expect(() =>
      parseFullAiRepositories(["VOICEVOX/voicevox/extra"]),
    ).toThrow();
  });

  it("重複した設定を拒否する", () => {
    expect(() =>
      parseFullAiRepositories([
        "VOICEVOX/voicevox_task_tracker",
        "voicevox/voicevox_task_tracker",
      ]),
    ).toThrow("重複");
  });

  it("設定ファイルを読み込める", async () => {
    const raw = JSON.parse(
      await readFile(
        new URL("../config/fullAiRepositories.json", import.meta.url),
        "utf8",
      ),
    );

    expect(parseFullAiRepositories(raw).size).toBeGreaterThan(0);
  });
});
