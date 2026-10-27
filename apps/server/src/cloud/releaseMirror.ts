// Fork: a server whose updates download from a `T3CODE_RELEASE_BASE_URL` mirror (the fork's
// GitHub releases) never sees its versions on npm, so clients ask it whether the mirror has the
// archive it would install. Browsers cannot read release assets cross-origin themselves.
import {
  CLI_RELEASE_BASE_URL_ENV,
  CLI_RELEASE_CHECKSUMS_FILE,
  cliArchiveFileName,
  cliArchivePlatformKey,
  cliReleaseDownloadBaseUrl,
  parseChecksums,
} from "@t3tools/shared/cliRelease";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpClient, HttpClientResponse } from "effect/http";

export const releaseMirrorBaseUrl = Config.String(CLI_RELEASE_BASE_URL_ENV).pipe(
  Config.option,
  Config.map((value) => Option.getOrUndefined(value)?.trim() || undefined),
);

/**
 * Reads the same checksums file the update downloads first: a release lists its archive there
 * only once CI attached both, and an update without that entry fails before downloading.
 */
export const releaseMirrorPublished = Effect.fn("cloud.release_mirror.published")(
  function* (input: {
    readonly httpClient: HttpClient.HttpClient;
    readonly baseUrl: string;
    readonly version: string;
    readonly platform: NodeJS.Platform;
    readonly arch: string;
  }) {
    const platformKey = cliArchivePlatformKey(input.platform, input.arch);
    if (platformKey === undefined) return false;
    const url = `${cliReleaseDownloadBaseUrl(input.version, input.baseUrl)}/${CLI_RELEASE_CHECKSUMS_FILE}`;
    return yield* input.httpClient.get(url).pipe(
      Effect.flatMap((response) =>
        response.status === 404
          ? Effect.succeed(false)
          : HttpClientResponse.filterStatusOk(response).pipe(
              Effect.flatMap((ok) => ok.text),
              Effect.map((text) =>
                parseChecksums(text).has(cliArchiveFileName(input.version, platformKey)),
              ),
            ),
      ),
      Effect.timeout("15 seconds"),
      Effect.catch((cause) =>
        Effect.logWarning("Could not check the release mirror.", { url, cause }).pipe(
          Effect.as(false),
        ),
      ),
    );
  },
);

export const makeReleaseMirrorCheck = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const platform = yield* HostProcess.Platform;
  const arch = yield* HostProcess.Architecture;
  const baseUrl = yield* releaseMirrorBaseUrl;
  return (version: string) =>
    baseUrl === undefined
      ? Effect.succeed(false)
      : releaseMirrorPublished({ httpClient, baseUrl, version, platform, arch });
});
