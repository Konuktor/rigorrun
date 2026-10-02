/**
 * The `permissions` pack: permission tests against a user's own MCP server,
 * described by a confirmed permission matrix (PHASE-4-DESIGN.md). The matrix
 * travels in the project's connector options — secret names only; the values
 * come from this machine's store or, failing that, the environment.
 */
import {
  getPack,
  hasPack,
  registerPack,
  type ActionDefinition,
  type PackConnectionConfig,
  type PackDefinition,
  type SafetyMode,
} from '@rigorrun/environment';
import type { DiscoveredTool } from '@rigorrun/mcp';
import { z } from 'zod';
import { callJson, openSide } from './connection.ts';
import { assertConfirmed, parseMatrix, type MatrixSide, type PermissionMatrix } from './matrix.ts';
import { PERMISSIONS_PACK_ID } from './rules.ts';
import { permissionsSchema } from './schema.ts';
import { openPermissionsSession, type Side } from './session.ts';
import { specFromMatrix } from './spec.ts';
import { permissionsSuite } from './suite.ts';
import type { ToolDescription } from '@rigorrun/core';

const OptionsSchema = z
  .object({
    matrix: z.unknown(),
    safety: z.enum(['production', 'staging', 'local', 'ephemeral']).optional(),
  })
  .strict();

export function actionFromDiscovered(tool: DiscoveredTool): ActionDefinition {
  const readOnly = tool.hints.readOnly === true;
  return {
    name: tool.name,
    description: tool.description,
    params: tool.params,
    mutates: readOnly ? [] : ['Row'],
    readOnly,
    enforcement: 'none',
  };
}

function secretName(matrix: PermissionMatrix, side: MatrixSide): string {
  const credential =
    side === 'reader'
      ? (matrix.credentials.reader ?? matrix.credentials.agent)
      : matrix.credentials[side];
  return credential.secret;
}

export async function openMatrixSide(
  matrix: PermissionMatrix,
  side: MatrixSide,
  secret: (name: string) => string | undefined,
): Promise<Side> {
  const name = secretName(matrix, side);
  const value = secret(name) ?? process.env[name];
  if (!value)
    throw new Error(`The ${side} credential is not set: store it as "${name}" or export ${name}.`);
  const connection = await openSide(matrix, side, value);
  return {
    call: (tool, args) => callJson(connection, tool, args),
    actions: async () => connection.discovery.tools.map(actionFromDiscovered),
    close: () => connection.close(),
  };
}

function auditReader(
  matrix: PermissionMatrix,
  observer: Side,
  secret: (name: string) => string | undefined,
): (() => Promise<unknown>) | undefined {
  const audit = matrix.audit;
  if (!audit) return undefined;
  if ('mcp' in audit.source) {
    const { tool, args } = audit.source.mcp;
    return () => observer.call(tool, args);
  }
  const http = audit.source.http;
  return async () => {
    const headers: Record<string, string> = {};
    if (http.header && http.secret) {
      const value = secret(http.secret) ?? process.env[http.secret];
      if (!value) throw new Error(`The audit credential is not set: "${http.secret}".`);
      headers[http.header] = `${http.prefix ?? ''}${value}`;
    }
    const response = await fetch(http.url, { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`The audit source answered ${response.status}.`);
    return (await response.json()) as unknown;
  };
}

function serverLabel(matrix: PermissionMatrix): string {
  return matrix.server.transport === 'http'
    ? matrix.server.url
    : [matrix.server.command, ...matrix.server.args].join(' ');
}

export function describePermissionsConnection(config: PackConnectionConfig): string {
  const parsed = OptionsSchema.safeParse(config.options ?? {});
  const matrix = parsed.success ? parseMatrix(parsed.data.matrix) : undefined;
  if (!matrix) return 'Opens the MCP server a permission matrix names (no valid matrix stored).';
  return (
    `Opens ${serverLabel(matrix)} twice: as ${matrix.tenant.a} (the agent's side) and as ` +
    `${matrix.tenant.b} (RigorRun's own reads${matrix.plant ? ' and planted markers' : ''})` +
    `${matrix.reset ? `, calling ${matrix.reset.tool} before each case` : ''}.`
  );
}

export interface PermissionsSuiteParams {
  matrix: unknown;
  confirmedRuleIds?: string[];
  createdAt?: string;
  tools?: ToolDescription[];
}

export const permissionsPack: PackDefinition = {
  id: PERMISSIONS_PACK_ID,
  name: 'Permissions',
  description:
    'Permission tests on your own MCP server: requests from one tenant that tempt the agent into ' +
    "another's records, decided from what the other tenant's own view shows.",
  schema: permissionsSchema,
  open: async (options) => {
    const parsed = OptionsSchema.parse(options.options ?? {});
    const matrix = parseMatrix(parsed.matrix);
    assertConfirmed(matrix);
    const secret = (name: string) => options.secret(name);
    const agent = await openMatrixSide(matrix, 'agent', secret);
    const reader = matrix.credentials.reader
      ? await openMatrixSide(matrix, 'reader', secret)
      : agent;
    const observer = await openMatrixSide(matrix, 'observer', secret);
    const readAudit = auditReader(matrix, observer, secret);
    return openPermissionsSession({
      spec: specFromMatrix(matrix),
      agent,
      reader,
      observer,
      ...(readAudit ? { readAudit } : {}),
      ...(matrix.reset
        ? { reset: { tool: matrix.reset.tool, args: { ...matrix.reset.args } } }
        : {}),
      system: serverLabel(matrix),
      safety: (parsed.safety ?? 'staging') as SafetyMode,
    });
  },
  describeAction: describePermissionsConnection,
  suite: (params) => {
    const p = params as PermissionsSuiteParams;
    const matrix = parseMatrix(p.matrix);
    assertConfirmed(matrix);
    return permissionsSuite(specFromMatrix(matrix), {
      confirmedRuleIds: p.confirmedRuleIds ?? [],
      ...(p.createdAt ? { createdAt: p.createdAt } : {}),
      ...(p.tools ? { tools: p.tools } : {}),
    });
  },
  cli: async (argv) => (await import('./cli/index.ts')).permissionsCli(argv),
};

export function registerPermissionsPack(): PackDefinition {
  if (!hasPack(PERMISSIONS_PACK_ID) || getPack(PERMISSIONS_PACK_ID) !== permissionsPack) {
    registerPack(permissionsPack);
  }
  return permissionsPack;
}
