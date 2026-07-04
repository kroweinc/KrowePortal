import "server-only";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { GRANOLA_MCP_RESOURCE } from "./oauth";

// Thin session helper for Granola's MCP server. Each user interaction opens
// one short-lived session (callGranolaTool for a single call,
// callGranolaToolsInSession to multiplex a batch over one transport) and
// closes it — no pooling, no shared transport state across requests.

/** HTTP 401/403 surfaced by the transport — token revoked or expired. */
export class GranolaMcpAuthError extends Error {
  constructor() {
    super("Granola rejected the access token.");
    this.name = "GranolaMcpAuthError";
  }
}

/** HTTP 429 surfaced by the transport. */
export class GranolaMcpRateLimitError extends Error {
  constructor() {
    super("Granola rate limit exceeded.");
    this.name = "GranolaMcpRateLimitError";
  }
}

function mapTransportError(err: unknown): never {
  if (err instanceof UnauthorizedError) throw new GranolaMcpAuthError();
  if (err instanceof StreamableHTTPError) {
    if (err.code === 401 || err.code === 403) throw new GranolaMcpAuthError();
    if (err.code === 429) throw new GranolaMcpRateLimitError();
  }
  throw err;
}

export async function withMcp<T>(
  accessToken: string,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  const transport = new StreamableHTTPClientTransport(new URL(GRANOLA_MCP_RESOURCE), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const client = new Client({ name: "krowe-portal", version: "1.0.0" });
  try {
    await client.connect(transport);
    return await fn(client);
  } catch (err) {
    mapTransportError(err);
  } finally {
    await client.close().catch(() => {});
  }
}

/** One tool call in its own session, transport errors mapped. */
export async function callGranolaTool(
  accessToken: string,
  name: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  return withMcp(accessToken, async (client) => {
    return (await client.callTool({ name, arguments: args })) as CallToolResult;
  });
}

export interface GranolaToolCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Several tool calls multiplexed concurrently over ONE session — a single
 * connect/handshake/teardown instead of one per call. The SDK correlates
 * concurrent requests by JSON-RPC id, so independent calls (e.g. a meeting's
 * detail + transcript) run in parallel. Results come back in `calls` order;
 * the first transport failure rejects the batch (mapped like withMcp).
 */
export async function callGranolaToolsInSession(
  accessToken: string,
  calls: GranolaToolCall[]
): Promise<CallToolResult[]> {
  return withMcp(accessToken, async (client) =>
    Promise.all(
      calls.map(
        (call) =>
          client.callTool({ name: call.name, arguments: call.args }) as Promise<CallToolResult>
      )
    )
  );
}

/**
 * Extract the payload from a tool result: structuredContent when present,
 * otherwise the first text block parsed as JSON (falling back to the raw
 * string if it isn't JSON).
 */
export function toolResultPayload(result: CallToolResult): unknown {
  if (result.structuredContent !== undefined && result.structuredContent !== null) {
    return result.structuredContent;
  }
  const text = result.content?.find((c) => c.type === "text")?.text;
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Concatenated text of an isError result, for classifying tool failures. */
export function toolErrorText(result: CallToolResult): string {
  return (result.content ?? [])
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join(" ");
}
