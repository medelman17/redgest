/**
 * MCP tool response envelope utilities.
 *
 * Every MCP tool returns a consistent shape:
 * - Success: `{ ok: true, data }` wrapped in MCP text content
 * - Error: `{ ok: false, error: { code, message } }` with `isError: true`
 */

/** Shape returned by MCP tool callbacks. Compatible with CallToolResult. */
export interface ToolResult {
  [key: string]: unknown;
  content: [{ type: "text"; text: string }];
  isError?: true;
}

/** Wrap a successful result in the MCP response envelope. */
export function envelope(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: true, data }) }],
  };
}

/** Wrap an error in the MCP response envelope with `isError` flag. */
export function envelopeError(code: string, message: string): ToolResult {
  return {
    content: [
      { type: "text", text: JSON.stringify({ ok: false, error: { code, message } }) },
    ],
    isError: true,
  };
}
