import { describe, expect, it } from "vite-plus/test";

import { importNotice } from "./importNotice.ts";

const result = { cloudDocId: "doc_1", commentsImported: 0, commentsSkipped: 0 };

describe("importNotice", () => {
  it("says the file stays, and how its comments fared", () => {
    expect(importNotice({ ...result, status: "imported" })).toBe(
      "Moved to Docs Cloud. This file stays in the project.",
    );
    expect(
      importNotice({ ...result, status: "imported", commentsImported: 1, commentsSkipped: 2 }),
    ).toBe(
      "Moved to Docs Cloud: 1 comment moved, 2 could not be placed because their text changed. This file stays in the project.",
    );
  });

  it("confirms an update and an import that already happened", () => {
    expect(importNotice({ ...result, status: "updated" })).toBe(
      "Docs Cloud now has this file's current text.",
    );
    expect(importNotice({ ...result, status: "skipped" })).toBe(
      "This file is already in Docs Cloud.",
    );
  });
});
