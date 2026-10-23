import { EMBED_ORIGINS_META, frameAncestorsPolicy } from "../shared/embed.ts";

const escapeAttribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/**
 * Only T3 Code origins may frame the app. The HTML also carries the same list
 * so the embed bridge can check postMessage origins against it.
 */
export async function withEmbedPolicy(
  response: Response,
  sources: ReadonlyArray<string>,
): Promise<Response> {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", frameAncestorsPolicy(sources));
  const isHtml = (headers.get("Content-Type") ?? "").startsWith("text/html");
  if (!isHtml || !response.body) {
    return new Response(response.body, { status: response.status, headers });
  }
  const meta = `<meta name="${EMBED_ORIGINS_META}" content="${escapeAttribute(sources.join(" "))}">`;
  const html = (await response.text()).replace("</head>", `${meta}</head>`);
  headers.delete("Content-Length");
  headers.delete("ETag");
  return new Response(html, { status: response.status, headers });
}
