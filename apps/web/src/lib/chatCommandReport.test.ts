import { describe, expect, it } from "vite-plus/test";

import { formatChatCommandReport } from "./chatCommandReport";

const success = { exitCode: 0, stdout: "", stderr: "", truncated: false, timedOut: false };

describe("formatChatCommandReport", () => {
  it("reports the exit code with both streams, without terminal colors", () => {
    const report = formatChatCommandReport("make build", {
      ...success,
      exitCode: 2,
      stdout: "\u001b[32mcompiling\u001b[0m\r\n",
      stderr: "error: missing file\n",
    });
    expect(report).toBe(
      [
        "I ran this command. It failed with exit code 2.",
        "```sh\nmake build\n```",
        "Output:",
        "```text\ncompiling\n```",
        "Errors:",
        "```text\nerror: missing file\n```",
      ].join("\n\n"),
    );
  });

  it("uses a longer fence when the output contains one", () => {
    const report = formatChatCommandReport("cat README.md", {
      ...success,
      stdout: "```js\nx\n```",
    });
    expect(report).toContain("````text\n```js\nx\n```\n````");
  });

  it("keeps the last lines of long output and says what was cut", () => {
    const stdout = Array.from({ length: 250 }, (_, index) => `line ${index + 1}`).join("\n");
    const report = formatChatCommandReport("seq 250", { ...success, stdout, truncated: true });
    expect(report).toContain("Output (last 200 lines, 50 cut):");
    expect(report).not.toContain("line 50\n");
    expect(report).toContain("line 51\n");
    expect(report).toContain("only its end was kept");
  });

  it("says when the command timed out or printed nothing", () => {
    const report = formatChatCommandReport("sleep 999", {
      ...success,
      exitCode: null,
      timedOut: true,
    });
    expect(report).toContain("stopped after 2 minutes");
    expect(report).toContain("It printed nothing.");
  });
});
