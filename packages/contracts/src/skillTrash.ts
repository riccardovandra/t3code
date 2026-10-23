import * as Schema from "effect/Schema";

import { SkillInstallTarget } from "./skills.ts";

/** A trash entry's folder name under the environment's skill trash, so it can't name another path. */
export const SkillTrashEntryId = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,127}$/),
);
export type SkillTrashEntryId = typeof SkillTrashEntryId.Type;

/** A skill Remove moved into the environment's trash, with where each part came from. */
export const SkillTrashEntry = Schema.Struct({
  id: SkillTrashEntryId,
  name: Schema.String,
  target: SkillInstallTarget,
  /** ISO time it was removed. */
  removedAt: Schema.String,
  /** Every original path: the skill's folders, then the agents' links to them. */
  paths: Schema.Array(Schema.String),
  /** The source its lock entry recorded, when the `skills` CLI installed it. */
  source: Schema.optional(Schema.String),
});
export type SkillTrashEntry = typeof SkillTrashEntry.Type;

export const SkillTrashListResult = Schema.Struct({ entries: Schema.Array(SkillTrashEntry) });
export type SkillTrashListResult = typeof SkillTrashListResult.Type;

export const SkillTrashEntryInput = Schema.Struct({ id: SkillTrashEntryId });
export type SkillTrashEntryInput = typeof SkillTrashEntryInput.Type;

export class SkillTrashError extends Schema.TaggedError<SkillTrashError>()("SkillTrashError", {
  reason: Schema.Literals([
    /** No trash entry has that id. */
    "notFound",
    /** Something now sits where the skill was; restore never overwrites it. */
    "occupied",
    /** A move, copy or lock write failed; `message` says which. */
    "failed",
  ]),
  message: Schema.String,
}) {}
