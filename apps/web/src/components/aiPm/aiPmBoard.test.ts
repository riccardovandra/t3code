import type { AiPmProjectSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { aiPmThreadPrompt, groupAiPmProjects } from "./aiPmBoard";

const project = (
  id: string,
  owner: string,
  area: string | null,
  waitingOnYou = 0,
): AiPmProjectSummary => ({
  id,
  name: id,
  owner,
  area,
  now: "",
  waitingOnYou,
  done: 0,
  total: 1,
  closed: null,
  version: null,
  outcome: null,
});

describe("groupAiPmProjects", () => {
  const projects = [
    project("slate", "Ops", "business", 2),
    project("audit", "Brand Connections", "client", 5),
    project("agents", "Bark", "client", 4),
    project("library", "Bark", "client", 0),
    project("digest", "Sales", null, 3),
  ];

  it("groups clients by name ahead of the user's own business", () => {
    expect(
      groupAiPmProjects(projects, "all").map((g) => [g.name, g.projects.map((p) => p.id)]),
    ).toEqual([
      ["Brand Connections", ["audit"]],
      ["Bark", ["agents", "library"]],
      ["Your business", ["digest", "slate"]],
    ]);
  });

  it("treats projects without an area as business and filters by scope", () => {
    expect(groupAiPmProjects(projects, "business").map((g) => g.name)).toEqual(["Your business"]);
    expect(groupAiPmProjects(projects, "client").map((g) => g.name)).toEqual([
      "Brand Connections",
      "Bark",
    ]);
  });
});

describe("aiPmThreadPrompt", () => {
  it("omits missing step and reason lines", () => {
    const prompt = aiPmThreadPrompt(
      { id: "slate", name: "Slate" },
      { title: "Ship it", owner: "you", step: null, why: null },
    );
    expect(prompt).toContain("Action: Ship it");
    expect(prompt).not.toContain("Step:");
    expect(prompt).not.toContain("Why:");
    expect(prompt).toContain("aipm brief slate");
  });
});
