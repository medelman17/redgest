import { createMiddleware } from "hono/factory";
import { timingSafeEqual } from "node:crypto";

/**
 * Bearer token authentication middleware for MCP HTTP transport.
 *
 * Mount on `/mcp/*` routes only — health check and other routes bypass auth.
 * Uses timing-safe comparison to prevent timing attacks on token validation.
 */
export function bearerAuthMiddleware(apiKey: string) {
  return createMiddleware(async (c, next) => {
    const header = c.req.header("Authorization");

    if (!header || !header.startsWith("Bearer ")) {
      return c.json(
        {
          ok: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Missing or invalid authorization",
          },
        },
        401,
      );
    }

    const token = header.slice(7);
    const tokenBuf = Buffer.from(token);
    const keyBuf = Buffer.from(apiKey);

    if (tokenBuf.length !== keyBuf.length || !timingSafeEqual(tokenBuf, keyBuf)) {
      return c.json(
        {
          ok: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Missing or invalid authorization",
          },
        },
        401,
      );
    }

    await next();
  });
}
