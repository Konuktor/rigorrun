// @ts-check
/**
 * Minimal MCP client over streamable HTTP (fetch only). This file is local to the fixture so the
 * black-box agent has no package dependency and imports nothing from RigorRun or the examples.
 */

/** @typedef {{ name: string, description?: string, inputSchema?: object }} McpTool */
/** @typedef {{ listTools(): Promise<McpTool[]>, callTool(name: string, args: Record<string, unknown>): Promise<unknown> }} McpClient */

let rpcId = 1;

const sleep = (/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms));

/**
 * @param {string} text
 * @param {string} contentType
 * @returns {any[]}
 */
function parseMessages(text, contentType) {
  const essence = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (essence === 'text/event-stream') {
    /** @type {any[]} */
    const messages = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      try {
        messages.push(JSON.parse(data));
      } catch {
        /* ignore partial SSE lines */
      }
    }
    return messages;
  }
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * @param {unknown} result
 * @returns {unknown}
 */
function callResultValue(result) {
  if (!result || typeof result !== 'object') return result;
  const /** @type {any} */ r = result;
  if (r.structuredContent !== undefined && r.structuredContent !== null) {
    return r.isError
      ? { ...r.structuredContent, isError: true, mcpError: true }
      : r.structuredContent;
  }
  const text = (r.content ?? [])
    .filter((/** @type {any} */ part) => part?.type === 'text' && typeof part.text === 'string')
    .map((/** @type {any} */ part) => part.text)
    .join('\n');
  if (r.isError) {
    try {
      return { ...JSON.parse(text), isError: true, mcpError: true };
    } catch {
      return { error: text, isError: true, mcpError: true };
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return text ? { text } : {};
  }
}

/**
 * @param {string} url
 * @param {string} token
 * @returns {Promise<McpClient>}
 */
export async function connect(url, token) {
  /** @type {string | undefined} */
  let sessionId;

  /**
   * @param {object | object[]} message
   * @param {{ expectId?: number }} [options]
   */
  async function send(message, { expectId } = {}) {
    const headers = {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    };
    /** @type {Error | undefined} */
    let lastTransport;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(message),
          signal: AbortSignal.timeout(60_000),
        });
        const nextSession = response.headers.get('mcp-session-id');
        if (nextSession) sessionId = nextSession;
        const contentType = response.headers.get('content-type') ?? '';
        const text = await response.text();
        if (!response.ok) {
          const detail = text.slice(0, 400);
          throw new Error(`MCP HTTP ${response.status}: ${detail}`);
        }
        const messages = parseMessages(text, contentType);
        if (expectId !== undefined) {
          const match = messages.find((entry) => entry?.id === expectId);
          if (match?.error) {
            throw new Error(match.error.message ?? JSON.stringify(match.error));
          }
          if (match?.result !== undefined) return match.result;
          throw new Error('MCP response had no result for the request.');
        }
        return undefined;
      } catch (error) {
        const transport =
          error instanceof TypeError ||
          (error instanceof Error &&
            (error.name === 'AbortError' || error.message.includes('fetch failed')));
        if (transport) {
          lastTransport = error instanceof Error ? error : new Error(String(error));
          if (attempt < 2) await sleep(250 * 2 ** attempt);
          continue;
        }
        throw error;
      }
    }
    throw lastTransport ?? new Error('MCP request failed after retries.');
  }

  /** @param {string} method @param {Record<string, unknown>} [params] */
  async function request(method, params = {}) {
    const id = rpcId++;
    return send({ jsonrpc: '2.0', id, method, params }, { expectId: id });
  }

  /** @param {string} method @param {Record<string, unknown>} [params] */
  async function notify(method, params = {}) {
    await send({ jsonrpc: '2.0', method, params });
  }

  await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'helpdesk-scripted-agent', version: '1.0.0' },
  });
  await notify('notifications/initialized', {});

  return {
    async listTools() {
      const /** @type {{ tools?: McpTool[] }} */ result = await request('tools/list', {});
      return result.tools ?? [];
    },
    async callTool(name, args) {
      try {
        const result = await request('tools/call', { name, arguments: args ?? {} });
        return callResultValue(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { error: message, isError: true, mcpError: true };
      }
    },
  };
}
