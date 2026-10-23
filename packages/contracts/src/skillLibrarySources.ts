import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { InstalledSkillName, SkillInstallTarget, SkillSource } from "./skills.ts";

/**
 * Fork: saved skill sources and the library built from them. A saved source is
 * a `SkillSource` with a label; the library previews each one and says where
 * its skills are already installed on the environment. Installs still go
 * through `skills.install` with the saved source.
 */

export const SkillSourceId = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/),
).pipe(Schema.brand("SkillSourceId"));
export type SkillSourceId = typeof SkillSourceId.Type;

export const SavedSkillSource = Schema.Struct({
  id: SkillSourceId,
  label: TrimmedNonEmptyString.check(Schema.isMaxLength(120)),
  source: SkillSource,
});
export type SavedSkillSource = typeof SavedSkillSource.Type;

export const SkillSourcesListResult = Schema.Struct({ sources: Schema.Array(SavedSkillSource) });
export type SkillSourcesListResult = typeof SkillSourcesListResult.Type;

/** Without an id, a new source gets one from its label. */
export const SkillSourceUpsertInput = Schema.Struct({
  id: Schema.optional(SkillSourceId),
  label: SavedSkillSource.fields.label,
  source: SkillSource,
});
export type SkillSourceUpsertInput = typeof SkillSourceUpsertInput.Type;

export const SkillSourceRemoveInput = Schema.Struct({ id: SkillSourceId });
export type SkillSourceRemoveInput = typeof SkillSourceRemoveInput.Type;

/** One saved source, or all of them. `refresh` fetches the sources again. */
export const SkillLibraryListInput = Schema.Struct({
  sourceId: Schema.optional(SkillSourceId),
  refresh: Schema.optional(Schema.Boolean),
});
export type SkillLibraryListInput = typeof SkillLibraryListInput.Type;

export const SkillLibrarySkill = Schema.Struct({
  /** The CLI's name for the skill, what `skills.install` takes. */
  name: InstalledSkillName,
  folder: TrimmedNonEmptyString,
  description: Schema.String,
  scripts: Schema.Boolean,
  /** Where a skill with this folder is installed on the environment now. */
  installedAt: Schema.Array(SkillInstallTarget),
});
export type SkillLibrarySkill = typeof SkillLibrarySkill.Type;

export const SkillLibrarySourceListing = Schema.Struct({
  source: SavedSkillSource,
  skills: Schema.Array(SkillLibrarySkill),
  /** Why the source couldn't be read; its skills are then empty. */
  error: Schema.optional(Schema.String),
});
export type SkillLibrarySourceListing = typeof SkillLibrarySourceListing.Type;

export const SkillLibraryListResult = Schema.Struct({
  sources: Schema.Array(SkillLibrarySourceListing),
});
export type SkillLibraryListResult = typeof SkillLibraryListResult.Type;

export class SkillSourcesError extends Schema.TaggedError<SkillSourcesError>()(
  "SkillSourcesError",
  {
    reason: Schema.Literals(["notFound", "storage"]),
    message: Schema.String,
  },
) {}
