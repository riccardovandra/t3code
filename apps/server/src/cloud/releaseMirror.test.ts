import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { releaseMirrorPublished } from "./releaseMirror.ts";

const baseUrl = "https://github.com/owner/fork/releases/download/";
const checksumsClient = (status: number, body: string, requests: string[] = []) =>
  HttpClient.make((request) => {
    requests.push(request.url);
    return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(body, { status })));
  });
const check = (httpClient: HttpClient.HttpClient, arch = "x64") =>
  releaseMirrorPublished({ httpClient, baseUrl, version: "0.1.8", platform: "linux", arch });

it.effect("reads the mirror's checksums for the archive this server would install", () =>
  Effect.gen(function* () {
    const requests: string[] = [];
    const published = yield* check(
      checksumsClient(200, `${"a".repeat(64)}  t3-0.1.8-linux-x64.tar.gz\n`, requests),
    );
    assert.isTrue(published);
    assert.deepStrictEqual(requests, [
      "https://github.com/owner/fork/releases/download/v0.1.8/SHA256SUMS",
    ]);
  }),
);

it.effect("is not published while the release lacks this platform's archive", () =>
  Effect.gen(function* () {
    assert.isFalse(
      yield* check(checksumsClient(200, `${"a".repeat(64)}  t3-0.1.8-darwin-arm64.tar.gz\n`)),
    );
    assert.isFalse(yield* check(checksumsClient(404, "Not Found")));
    assert.isFalse(yield* check(checksumsClient(502, "Bad Gateway")));
    assert.isFalse(yield* check(checksumsClient(200, ""), "ia32"));
  }),
);
