import type { DiscoveredTool } from '@rigorrun/mcp';
import {
  permissionMatrixSchema,
  type MatrixCredentials,
  type MatrixServer,
  type PermissionMatrix,
} from './matrix.ts';

const READ_NAME = /^(list|get|search|find|export)_(.+)$/i;
const SINK_NAME = /(send|email|message|notify|share)/i;
const RECIPIENT_ARGUMENTS = new Set(['to', 'email', 'recipient', 'phone', 'address']);
const FORBIDDEN_NAME = /^(delete|remove|purge|drop|export)/i;
const ASK_PLACEHOLDER = 'TODO: what a requester would ask for';

function hasNoRequiredArguments(tool: DiscoveredTool): boolean {
  return !tool.params.some((param) => param.required);
}

function readEntity(tool: DiscoveredTool): string | undefined {
  const match = READ_NAME.exec(tool.name);
  if (!hasNoRequiredArguments(tool)) return undefined;
  if (match) return match[2];
  if (tool.hints.readOnly === true) return tool.name;
  return undefined;
}

export function draftMatrix(
  tools: DiscoveredTool[],
  server: MatrixServer,
  credentials: MatrixCredentials,
): PermissionMatrix {
  const reads = tools.flatMap((tool) => {
    const entity = readEntity(tool);
    return entity === undefined ? [] : [{ tool: tool.name, args: {}, rows: '', entity }];
  });

  const sinks = tools.flatMap((tool) => {
    if (!SINK_NAME.test(tool.name)) return [];
    const recipient = tool.params.find((param) =>
      RECIPIENT_ARGUMENTS.has(param.name.toLowerCase()),
    );
    return recipient ? [{ tool: tool.name, recipient_arg: recipient.name }] : [];
  });

  const forbidden = tools.flatMap((tool) => {
    const match = FORBIDDEN_NAME.exec(tool.name);
    return match ? [{ tool: tool.name, ask: `${match[1]!.toLowerCase()} ${ASK_PLACEHOLDER}` }] : [];
  });

  const resetTools = tools.filter((tool) => /reset/i.test(tool.name));
  const reset = resetTools.length === 1 ? { tool: resetTools[0]!.name, args: {} } : undefined;
  const pending = [
    'reads',
    ...(sinks.length > 0 ? ['sinks'] : []),
    ...(forbidden.length > 0 ? ['forbidden'] : []),
    ...(reset ? ['reset'] : []),
    'tenant.field',
    'tenant.a',
    'tenant.b',
    'tenant.label',
    'labels.record',
    'labels.person',
    'reference.entity',
    'reference.field',
    'person.entity',
    'person.name_field',
    'fingerprint_fields',
    'outside_address',
    'policy',
  ];

  return permissionMatrixSchema.parse({
    version: 0,
    unconfirmed: pending,
    server,
    credentials,
    tenant: { field: 'TODO', a: 'TODO', b: 'TODO', label: 'TODO' },
    labels: { record: 'TODO', person: 'TODO' },
    reads,
    reference: { entity: 'TODO', field: 'TODO' },
    person: { entity: 'TODO', name_field: 'TODO' },
    fingerprint_fields: ['TODO'],
    ...(sinks.length > 0 ? { sinks } : {}),
    ...(forbidden.length > 0 ? { forbidden } : {}),
    ...(reset ? { reset } : {}),
    outside_address: 'exfil@example.net',
    policy: ['TODO'],
  });
}
