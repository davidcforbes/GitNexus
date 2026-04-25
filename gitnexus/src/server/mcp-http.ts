/**
 * MCP over HTTP
 *
 * Mounts the GitNexus MCP server on Express using StreamableHTTP transport.
 * Each connecting client gets its own stateful session; the LocalBackend
 * is shared across all sessions (thread-safe — lazy LadybugDB per repo).
 *
 * Sessions are cleaned up on explicit close or after SESSION_TTL_MS of inactivity
 * (guards against network drops that never trigger onclose).
 */

import type { Express, Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createMCPServer } from '../mcp/server.js';
import type { LocalBackend } from '../mcp/local/local-backend.js';
import { randomUUID } from 'crypto';

interface MCPSession {
  server: Server;
  transport: StreamableHTTPServerTransport;
  lastActivity: number;
}

/** Idle sessions are evicted after 30 minutes */
const SESSION_TTL_MS = 30 * 60 * 1000;
/** Cleanup sweep runs every 5 minutes */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
/**
 * Hard cap on concurrent MCP sessions. Past this, new initialize POSTs
 * get a 503 instead of growing the session map without bound. Sized for
 * typical IDE-side use (one session per editor); raise via
 * GITNEXUS_MCP_MAX_SESSIONS for shared deployments. (GitNexus-8vx)
 */
const DEFAULT_MAX_SESSIONS = 64;
const MAX_SESSIONS = (() => {
  const env = process.env.GITNEXUS_MCP_MAX_SESSIONS;
  const parsed = env ? Number(env) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_SESSIONS;
})();

/**
 * MCP session-ids are UUIDs (transport-generated via randomUUID()) — so
 * a client-supplied value that doesn't look like one can never match a
 * stored entry. Reject obviously-malformed IDs at the door so a flood of
 * crafted headers can't drive us through the unknown-session 404 branch
 * thousands of times.
 */
const SESSION_ID_RE = /^[a-zA-Z0-9_-]{8,128}$/;

export function mountMCPEndpoints(app: Express, backend: LocalBackend): () => Promise<void> {
  const sessions = new Map<string, MCPSession>();

  // Periodic cleanup of idle sessions (guards against network drops)
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastActivity > SESSION_TTL_MS) {
        try {
          session.server.close();
        } catch {}
        sessions.delete(id);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  if (cleanupTimer && typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    (cleanupTimer as NodeJS.Timeout).unref();
  }

  const handleMcpRequest = async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    // GitNexus-8vx: validate the header shape before using it. Garbage
    // values (long strings, control chars, etc.) hit the unknown-session
    // 404 branch — bouncing them at validation costs less and provides a
    // clearer error.
    if (sessionId && !SESSION_ID_RE.test(sessionId)) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32600, message: 'Malformed mcp-session-id header.' },
        id: null,
      });
      return;
    }

    if (sessionId && sessions.has(sessionId)) {
      // Existing session — delegate to its transport
      const session = sessions.get(sessionId)!;
      session.lastActivity = Date.now();
      await session.transport.handleRequest(req, res, req.body);
    } else if (sessionId) {
      // Unknown/expired session ID — tell client to re-initialize (per MCP spec)
      res.status(404).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Session not found. Re-initialize.' },
        id: null,
      });
    } else if (req.method === 'POST') {
      // GitNexus-8vx: bound the session map. Without this a flood of
      // unauthenticated POSTs to /api/mcp grows the Map (and creates
      // a new Server + transport per request) until heap or FD
      // exhaustion — well before the 30-minute TTL eviction can fire.
      if (sessions.size >= MAX_SESSIONS) {
        res.status(503).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: `MCP session capacity reached (${MAX_SESSIONS}). Try again later or raise GITNEXUS_MCP_MAX_SESSIONS.`,
          },
          id: null,
        });
        return;
      }

      // No session ID — new client initializing
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });
      const server = createMCPServer(backend);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      if (transport.sessionId) {
        sessions.set(transport.sessionId, { server, transport, lastActivity: Date.now() });
        transport.onclose = () => {
          sessions.delete(transport.sessionId!);
        };
      }
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'No valid session. Send a POST to initialize.' },
        id: null,
      });
    }
  };

  app.all('/api/mcp', (req: Request, res: Response) => {
    void handleMcpRequest(req, res).catch((err: any) => {
      console.error('MCP HTTP request failed:', err);
      if (res.headersSent) return;
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Internal MCP server error' },
        id: null,
      });
    });
  });

  const cleanup = async () => {
    clearInterval(cleanupTimer);
    const closers = [...sessions.values()].map(async (session) => {
      try {
        await Promise.resolve(session.server.close());
      } catch {}
    });
    sessions.clear();
    await Promise.allSettled(closers);
  };

  console.log('MCP HTTP endpoints mounted at /api/mcp');
  return cleanup;
}
