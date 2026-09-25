import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { resolve } from "node:path";

/**
 * Serve the built web app (apps/web/dist) for single-box hosting: hashed
 * assets are cached for a year, and every other non-API path gets index.html
 * so the app's own routes work on reload.
 */
export async function serveWebApp(app: FastifyInstance, dir: string): Promise<void> {
  const root = resolve(dir);
  await app.register(fastifyStatic, {
    root,
    wildcard: false,
    setHeaders: (res, path) => {
      res.header("cache-control", path.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
    },
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found." });
    return reply.header("cache-control", "no-cache").sendFile("index.html", root);
  });
}
