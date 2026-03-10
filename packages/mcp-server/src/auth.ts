import { createMiddleware } from "hono/factory";
import { timingSafeEqual } from "node:crypto";

const UNAUTHORIZED_BODY = {
  ok: false,
  error: { code: "UNAUTHORIZED", message: "Missing or invalid authorization" },
} as const;

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
      return c.json(UNAUTHORIZED_BODY, 401);
    }

    const token = header.slice(7);
    const tokenBuf = Buffer.from(token);
    const keyBuf = Buffer.from(apiKey);

    if (tokenBuf.length !== keyBuf.length || !timingSafeEqual(tokenBuf, keyBuf)) {
      return c.json(UNAUTHORIZED_BODY, 401);
    }

    await next();
  });
}
