import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Caching for public reads. Anonymous viewers all see the same data, so a CDN
 * or the browser may reuse a response for a couple of seconds and then check
 * back with the version tag (304 Not Modified when nothing changed). Anything
 * requested with a staff link is private and never stored.
 *
 * Returns true when a 304 was sent and the handler should stop.
 */
export function publicCache(req: FastifyRequest, reply: FastifyReply, version: string, maxAgeSec = 2): boolean {
  if (req.headers.authorization) {
    reply.header("cache-control", "private, no-store");
    return false;
  }
  const etag = `W/"${version}"`;
  reply.header("cache-control", `public, max-age=${maxAgeSec}, stale-while-revalidate=${maxAgeSec * 5}`);
  reply.header("etag", etag);
  const match = req.headers["if-none-match"];
  if (match && match.split(",").some((t) => t.trim() === etag)) {
    reply.code(304).send();
    return true;
  }
  return false;
}
