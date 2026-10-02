import { McpConnection, type McpConfig } from '@rigorrun/mcp';
import type { MatrixSide, PermissionMatrix } from './matrix.ts';

export function sideConfig(
  matrix: Pick<PermissionMatrix, 'server' | 'credentials'>,
  side: MatrixSide,
  secretValue: string,
): McpConfig {
  const credential = matrix.credentials[side];
  const application = credential.apply;

  if (matrix.server.transport === 'stdio') {
    if (!('env' in application)) {
      throw new Error(`Cannot apply a header credential to a stdio MCP server (${side}).`);
    }
    return {
      ...matrix.server,
      env: { ...(matrix.server.env ?? {}), [application.env]: secretValue },
    };
  }

  if (!('header' in application)) {
    throw new Error(`Cannot apply an environment credential to an HTTP MCP server (${side}).`);
  }
  return {
    ...matrix.server,
    headers: {
      [application.header]: `${application.prefix ?? ''}${secretValue}`,
    },
  };
}

export const buildSideConfig = sideConfig;

export async function openSide(
  matrix: PermissionMatrix,
  side: MatrixSide,
  secretValue: string,
): Promise<McpConnection> {
  return await McpConnection.open(buildSideConfig(matrix, side, secretValue));
}

export async function callJson(
  connection: McpConnection,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await connection.call(tool, args);
  if (!result.ok) {
    const detail = result.error?.message ? `: ${result.error.message}` : '';
    throw new Error(`MCP tool ${tool} failed${detail}`);
  }
  if (result.structured !== undefined) return result.structured;

  const parts = Array.isArray(result.content) ? result.content : [];
  const text = parts.find(
    (part): part is { type: 'text'; text: string } =>
      typeof part === 'object' &&
      part !== null &&
      (part as { type?: unknown }).type === 'text' &&
      typeof (part as { text?: unknown }).text === 'string',
  );
  if (!text) throw new Error(`MCP tool ${tool} returned no JSON content.`);

  try {
    return JSON.parse(text.text) as unknown;
  } catch (error) {
    throw new Error(`MCP tool ${tool} returned non-JSON text.`, { cause: error });
  }
}
