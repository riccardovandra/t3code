/**
 * SkillTrash - where Remove puts a skill instead of deleting it (fork).
 *
 * Each entry is a folder under `<userdata>/skill-trash/<id>/`: the skill's
 * folders moved to `items/<n>`, and `entry.json` recording every original
 * path, each agent link's target (links are recorded, not moved), and the
 * lock entry Remove took out of the `skills` CLI's lock file. Restore puts
 * all of it back and never overwrites what has since taken a path.
 *
 * Callers serialize changes: SkillLibrary runs these under the semaphore that
 * guards the lock files.
 *
 * @module SkillTrash
 */
import {
  SkillInstallTarget,
  type SkillTrashEntry,
  SkillTrashEntryId,
  SkillTrashError,
} from "@t3tools/contracts";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";

export interface SkillTrashPutInput {
  readonly name: string;
  readonly target: SkillInstallTarget;
  /**
   * Paths that may hold the skill: its folders and the agents' links to
   * them. Missing ones are skipped, and one reached again through a linked
   * parent folder counts once.
   */
  readonly paths: ReadonlyArray<string>;
  /** The lock file and key whose entry goes into the trash with the files. */
  readonly lock?: { readonly file: string; readonly key: string };
}

export class SkillTrash extends Context.Service<
  SkillTrash,
  {
    readonly put: (input: SkillTrashPutInput) => Effect.Effect<SkillTrashEntry, SkillTrashError>;
    /** Newest first. Entries whose record can't be read are left out. */
    readonly list: Effect.Effect<ReadonlyArray<SkillTrashEntry>>;
    /** Put an entry back where it was, then drop it from the trash. */
    readonly restore: (id: string) => Effect.Effect<SkillTrashEntry, SkillTrashError>;
    readonly deletePermanently: (id: string) => Effect.Effect<void, SkillTrashError>;
  }
>()("t3/skills/SkillTrash") {}

const TrashItem = Schema.Union([
  /** A folder or file, moved into the entry. */
  Schema.Struct({
    path: Schema.String,
    stored: Schema.String.check(Schema.isPattern(/^items\/\d+$/)),
  }),
  /** A link, recreated with the same target. */
  Schema.Struct({ path: Schema.String, link: Schema.String }),
]);
type TrashItem = typeof TrashItem.Type;

const TrashLock = Schema.Struct({
  file: Schema.String,
  key: Schema.String,
  entry: Schema.Unknown,
  /** The lock's `version`, for writing a new lock file if it is gone on restore. */
  version: Schema.optional(Schema.Unknown),
});
type TrashLock = typeof TrashLock.Type;

const TrashRecord = Schema.Struct({
  id: SkillTrashEntryId,
  name: Schema.String,
  target: SkillInstallTarget,
  removedAt: Schema.String,
  items: Schema.Array(TrashItem),
  lock: Schema.optional(TrashLock),
});
type TrashRecord = typeof TrashRecord.Type;
const decodeRecord = Schema.decodeUnknownOption(fromLenientJson(TrashRecord));
const isEntryId = Schema.is(SkillTrashEntryId);

const RECORD_FILE = "entry.json";

/** Lock files are JSON the `skills` CLI pretty-prints; records match them. */
const PrettyJson = Schema.fromJsonString(Schema.Unknown, { space: 2 });
const encodePrettyJson = Schema.encodeSync(PrettyJson);
const prettyJson = (value: unknown) => `${encodePrettyJson(value)}\n`;
const decodeJson = Schema.decodeUnknownEffect(PrettyJson);

const failed = (message: string) => new SkillTrashError({ reason: "failed", message });

function toEntry(record: TrashRecord): SkillTrashEntry {
  const entry = record.lock?.entry;
  const source =
    typeof entry === "object" && entry !== null && "source" in entry ? entry.source : undefined;
  return {
    id: record.id,
    name: record.name,
    target: record.target,
    removedAt: record.removedAt,
    // Folders first: they are the skill, links only point at it.
    paths: [
      ...record.items.filter((item) => "stored" in item),
      ...record.items.filter((item) => "link" in item),
    ].map((item) => item.path),
    ...(typeof source === "string" ? { source } : {}),
  };
}

function isCrossDevice(error: PlatformError.PlatformError): boolean {
  const cause = error.reason.cause;
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "EXDEV";
}

/**
 * Move by copying, for when `from` and `to` are on different filesystems.
 * The source goes only after the copy matches it file for file.
 */
export const moveByCopy = Effect.fn("SkillTrash.moveByCopy")(function* (from: string, to: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  /** Each path under `root` with its kind and size or link target, sorted. */
  const describe = Effect.fnUntraced(function* (root: string) {
    const lines: string[] = [];
    const pending = [""];
    while (pending.length > 0) {
      const relative = pending.pop() ?? "";
      const absolute = relative === "" ? root : path.join(root, relative);
      const link = yield* fileSystem.readLink(absolute).pipe(Effect.option);
      if (Option.isSome(link)) {
        lines.push(`L ${relative} ${link.value}`);
        continue;
      }
      const info = yield* fileSystem.stat(absolute);
      if (info.type !== "Directory") {
        lines.push(`F ${relative} ${info.size} ${info.mode & 0o777}`);
        continue;
      }
      lines.push(`D ${relative}`);
      for (const name of yield* fileSystem.readDirectory(absolute)) {
        pending.push(relative === "" ? name : path.join(relative, name));
      }
    }
    return lines.toSorted().join("\n");
  });
  // `FileSystem.copy` rewrites relative links to absolute ones, which would
  // point back at the source once it is gone, so links are copied as written.
  const pending: Array<readonly [string, string]> = [[from, to]];
  while (pending.length > 0) {
    const [source, destination] = pending.pop() ?? [from, to];
    const link = yield* fileSystem.readLink(source).pipe(Effect.option);
    if (Option.isSome(link)) {
      yield* fileSystem.symlink(link.value, destination);
      continue;
    }
    const info = yield* fileSystem.stat(source);
    if (info.type !== "Directory") {
      yield* fileSystem.copyFile(source, destination);
      yield* fileSystem.chmod(destination, info.mode & 0o777);
      continue;
    }
    yield* fileSystem.makeDirectory(destination);
    for (const name of yield* fileSystem.readDirectory(source)) {
      pending.push([path.join(source, name), path.join(destination, name)]);
    }
  }
  const [source, copy] = [yield* describe(from), yield* describe(to)];
  if (source !== copy) {
    yield* fileSystem.remove(to, { recursive: true }).pipe(Effect.ignore);
    return yield* failed(`The copy of ${from} didn't match it, so it was left in place.`);
  }
  yield* fileSystem.remove(from, { recursive: true });
});

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const config = yield* ServerConfig.ServerConfig;
  const root = path.join(config.stateDir, "skill-trash");

  const readLink = (target: string) =>
    fileSystem.readLink(target).pipe(Effect.option, Effect.map(Option.getOrUndefined));
  /** Something is at `target`, counting a link whose target is gone. */
  const occupied = (target: string) =>
    readLink(target).pipe(
      Effect.flatMap((link) =>
        link === undefined
          ? fileSystem.exists(target).pipe(Effect.orElseSucceed(() => false))
          : Effect.succeed(true),
      ),
    );

  const move = (from: string, to: string) =>
    fileSystem.rename(from, to).pipe(
      Effect.catchTags({
        PlatformError: (error) =>
          isCrossDevice(error)
            ? moveByCopy(from, to).pipe(
                Effect.provideService(FileSystem.FileSystem, fileSystem),
                Effect.provideService(Path.Path, path),
              )
            : Effect.fail(error),
      }),
    );

  const describeFailure =
    (action: string) => (error: PlatformError.PlatformError | SkillTrashError) =>
      error._tag === "SkillTrashError" ? error : failed(`Couldn't ${action}: ${error.message}`);

  /** A lock file as JSON, keeping fields T3 doesn't read. */
  const readLockJson = (file: string) =>
    fileSystem.readFileString(file).pipe(
      Effect.flatMap((text) =>
        decodeJson(text).pipe(
          Effect.mapError(() =>
            failed(`${file} isn't valid JSON, so the skill's entry was left in it.`),
          ),
        ),
      ),
      Effect.flatMap((json) =>
        typeof json === "object" && json !== null && !Array.isArray(json)
          ? Effect.succeed(json as Record<string, unknown>)
          : Effect.fail(failed(`${file} isn't a skills lock file.`)),
      ),
    );
  const skillsOf = (lock: Record<string, unknown>): Record<string, unknown> =>
    typeof lock.skills === "object" && lock.skills !== null && !Array.isArray(lock.skills)
      ? (lock.skills as Record<string, unknown>)
      : {};
  const writeLockJson = (file: string, lock: Record<string, unknown>) =>
    fileSystem.writeFileString(file, prettyJson(lock));

  /** Take a key out of a lock, returning what it held. */
  const takeLockEntry = Effect.fn("SkillTrash.takeLockEntry")(function* (
    file: string,
    key: string,
  ) {
    const lock = yield* readLockJson(file);
    const skills = { ...skillsOf(lock) };
    if (!Object.hasOwn(skills, key)) return undefined;
    const entry = skills[key];
    delete skills[key];
    yield* writeLockJson(file, { ...lock, skills });
    return {
      file,
      key,
      entry,
      ...(lock.version === undefined ? {} : { version: lock.version }),
    } satisfies TrashLock;
  });

  const putLockEntry = Effect.fn("SkillTrash.putLockEntry")(function* (lock: TrashLock) {
    const current = (yield* fileSystem.exists(lock.file))
      ? yield* readLockJson(lock.file)
      : lock.version === undefined
        ? {}
        : { version: lock.version };
    if (Object.hasOwn(skillsOf(current), lock.key)) {
      return yield* new SkillTrashError({
        reason: "occupied",
        message: `${lock.file} already has an entry for ${lock.key}.`,
      });
    }
    yield* fileSystem.makeDirectory(path.dirname(lock.file), { recursive: true });
    yield* writeLockJson(lock.file, {
      ...current,
      skills: { ...skillsOf(current), [lock.key]: lock.entry },
    });
  });

  /** Put items back, folders before the links that point at them. */
  const placeItems = (directory: string, items: ReadonlyArray<TrashItem>, placed: TrashItem[]) =>
    Effect.forEach(
      [...items.filter((item) => "stored" in item), ...items.filter((item) => "link" in item)],
      (item) =>
        Effect.gen(function* () {
          yield* fileSystem.makeDirectory(path.dirname(item.path), { recursive: true });
          if ("stored" in item) yield* move(path.join(directory, item.stored), item.path);
          else yield* fileSystem.symlink(item.link, item.path);
          placed.push(item);
        }),
      { discard: true },
    );

  /** Take items out of their places into the entry, links before what they point at. */
  const takeItems = (directory: string, items: ReadonlyArray<TrashItem>, taken: TrashItem[]) =>
    Effect.forEach(
      [...items.filter((item) => "link" in item), ...items.filter((item) => "stored" in item)],
      (item) =>
        Effect.gen(function* () {
          if ("stored" in item) yield* move(item.path, path.join(directory, item.stored));
          else yield* fileSystem.remove(item.path);
          taken.push(item);
        }),
      { discard: true },
    );

  const readRecord = Effect.fn("SkillTrash.readRecord")(function* (id: string) {
    const notFound = new SkillTrashError({
      reason: "notFound",
      message: "That skill isn't in the trash any more.",
    });
    if (!isEntryId(id)) return yield* notFound;
    const text = yield* fileSystem
      .readFileString(path.join(root, id, RECORD_FILE))
      .pipe(Effect.mapError(() => notFound));
    return yield* Option.match(decodeRecord(text), {
      onNone: () => Effect.fail(failed(`The trash record for ${id} can't be read.`)),
      onSome: (record) =>
        record.id === id ? Effect.succeed(record) : Effect.fail(failed("Mismatched record.")),
    });
  });

  const put: SkillTrash["Service"]["put"] = Effect.fn("SkillTrash.put")(function* (input) {
    const now = yield* DateTime.now;
    const random = yield* crypto
      .randomBytes(6)
      .pipe(Effect.mapError(describeFailure(`move ${input.name} to the trash`)));
    const id = `${DateTime.toEpochMillis(now).toString(36)}-${Hex.encode(random)}`;
    const directory = path.join(root, id);

    // One item per place: `~/.claude/skills` may itself link to `~/.agents/skills`.
    const items: TrashItem[] = [];
    const seen = new Set<string>();
    for (const candidate of input.paths) {
      const parent = yield* fileSystem
        .realPath(path.dirname(candidate))
        .pipe(Effect.orElseSucceed(() => path.dirname(candidate)));
      const place = path.join(parent, path.basename(candidate));
      if (seen.has(place) || !(yield* occupied(candidate))) continue;
      seen.add(place);
      const link = yield* readLink(candidate);
      items.push(
        link === undefined
          ? { path: candidate, stored: `items/${items.length}` }
          : { path: candidate, link },
      );
    }

    const taken: TrashItem[] = [];
    let lock: TrashLock | undefined;
    const record = Effect.gen(function* () {
      yield* fileSystem.makeDirectory(path.join(directory, "items"), { recursive: true });
      yield* takeItems(directory, items, taken);
      if (input.lock !== undefined) lock = yield* takeLockEntry(input.lock.file, input.lock.key);
      const saved: TrashRecord = {
        id,
        name: input.name,
        target: input.target,
        removedAt: DateTime.formatIso(now),
        items,
        ...(lock === undefined ? {} : { lock }),
      };
      yield* fileSystem.writeFileString(path.join(directory, RECORD_FILE), prettyJson(saved));
      return toEntry(saved);
    });
    return yield* record.pipe(
      // A half-trashed skill is worse than none: put back what moved.
      Effect.onError(() =>
        Effect.gen(function* () {
          if (lock !== undefined) yield* putLockEntry(lock).pipe(Effect.ignore);
          yield* placeItems(directory, taken.toReversed(), []).pipe(Effect.ignore);
          yield* fileSystem.remove(directory, { recursive: true }).pipe(Effect.ignore);
        }),
      ),
      Effect.mapError(describeFailure(`move ${input.name} to the trash`)),
    );
  });

  const list: SkillTrash["Service"]["list"] = Effect.gen(function* () {
    const ids = yield* fileSystem.readDirectory(root).pipe(Effect.orElseSucceed(() => []));
    const records = yield* Effect.forEach(ids.filter(isEntryId), (id) =>
      readRecord(id).pipe(Effect.option),
    );
    return records
      .flatMap((record) => (Option.isSome(record) ? [toEntry(record.value)] : []))
      .toSorted((left, right) => right.removedAt.localeCompare(left.removedAt));
  }).pipe(Effect.withSpan("SkillTrash.list"));

  const restore: SkillTrash["Service"]["restore"] = Effect.fn("SkillTrash.restore")(function* (id) {
    const record = yield* readRecord(id);
    const directory = path.join(root, id);
    for (const item of record.items) {
      if (yield* occupied(item.path)) {
        return yield* new SkillTrashError({
          reason: "occupied",
          message: `Something is already at ${item.path}. Move it away, then restore ${record.name}.`,
        });
      }
    }
    const placed: TrashItem[] = [];
    let lockPlaced = false;
    yield* Effect.gen(function* () {
      // The lock first: it refuses without changing anything when the key is back.
      if (record.lock !== undefined) {
        yield* putLockEntry(record.lock);
        lockPlaced = true;
      }
      yield* placeItems(directory, record.items, placed);
    }).pipe(
      Effect.onError(() =>
        Effect.gen(function* () {
          yield* takeItems(directory, placed.toReversed(), []).pipe(Effect.ignore);
          if (lockPlaced && record.lock !== undefined) {
            yield* takeLockEntry(record.lock.file, record.lock.key).pipe(Effect.ignore);
          }
        }),
      ),
      Effect.mapError(describeFailure(`restore ${record.name}`)),
    );
    yield* fileSystem.remove(directory, { recursive: true }).pipe(Effect.ignore);
    return toEntry(record);
  });

  const deletePermanently: SkillTrash["Service"]["deletePermanently"] = Effect.fn(
    "SkillTrash.deletePermanently",
  )(function* (id) {
    const record = yield* readRecord(id);
    yield* fileSystem
      .remove(path.join(root, record.id), { recursive: true })
      .pipe(Effect.mapError(describeFailure(`delete ${record.name}`)));
  });

  return SkillTrash.of({ put, list, restore, deletePermanently });
});

export const layer = Layer.effect(SkillTrash, make);
