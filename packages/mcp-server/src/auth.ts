import { createMiddleware } from "hono/factory";

/**
 * Bearer token authentication middleware for MCP HTTP transport.
 *
 * Mount on `/mcp/*` routes only — health check and other routes bypass auth.
 */
export function bearerAuthMiddleware(apiKey: string) {
  return createMiddleware(async (c, next) => {
    const header = c.req.header("Authorization");

    if (!header || !header.startsWith("Bearer ") || header.slice(7) !== apiKey) {
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
