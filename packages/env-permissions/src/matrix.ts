import { z } from 'zod';

const jsonObject = z.record(z.string(), z.unknown());
const stringMap = z.record(z.string(), z.string());

export const stdioServerSchema = z
  .object({
    transport: z.literal('stdio'),
    command: z.string().min(1),
    args: z.array(z.string()),
    env: stringMap.optional(),
  })
  .strict();

export const httpServerSchema = z
  .object({
    transport: z.literal('http'),
    url: z.string().min(1),
  })
  .strict();

export const matrixServerSchema = z.discriminatedUnion('transport', [
  stdioServerSchema,
  httpServerSchema,
]);

const headerApplicationSchema = z
  .object({
    header: z.string().min(1),
    prefix: z.string().optional(),
  })
  .strict();

const environmentApplicationSchema = z
  .object({
    env: z.string().min(1),
  })
  .strict();

export const credentialSchema = z
  .object({
    secret: z.string().min(1),
    apply: z.union([headerApplicationSchema, environmentApplicationSchema]),
  })
  .strict();

export const matrixCredentialsSchema = z
  .object({
    agent: credentialSchema,
    /** RigorRun's own read of tenant A; defaults to the agent's credential. */
    reader: credentialSchema.optional(),
    observer: credentialSchema,
  })
  .strict();

const readSchema = z
  .object({
    tool: z.string().min(1),
    args: jsonObject,
    rows: z.string(),
    entity: z.string().min(1),
  })
  .strict();

const operationSchema = z
  .object({
    tool: z.string().min(1),
    args: jsonObject,
  })
  .strict();

const mcpAuditSourceSchema = z
  .object({
    mcp: operationSchema,
  })
  .strict();

const httpAuditSourceSchema = z
  .object({
    http: z
      .object({
        url: z.string().min(1),
        header: z.string().min(1).optional(),
        prefix: z.string().optional(),
        secret: z.string().min(1).optional(),
      })
      .strict(),
  })
  .strict();

export const permissionMatrixSchema = z
  .object({
    version: z.literal(0),
    unconfirmed: z.array(z.string().min(1)),
    server: matrixServerSchema,
    credentials: matrixCredentialsSchema,
    tenant: z
      .object({
        field: z.string().min(1),
        a: z.string().min(1),
        b: z.string().min(1),
        label: z.string().min(1),
      })
      .strict(),
    labels: z
      .object({
        record: z.string().min(1),
        person: z.string().min(1),
      })
      .strict(),
    reads: z.array(readSchema),
    reference: z
      .object({
        entity: z.string().min(1),
        field: z.string().min(1),
      })
      .strict(),
    person: z
      .object({
        entity: z.string().min(1),
        name_field: z.string().min(1),
      })
      .strict(),
    fingerprint_fields: z.array(z.string().min(1)),
    plant: operationSchema.optional(),
    audit: z
      .object({
        source: z.union([mcpAuditSourceSchema, httpAuditSourceSchema]),
        rows: z.string(),
        owner_field: z.string().min(1),
        actor_field: z.string().min(1),
        /** The actor value of RigorRun's own (observer's) reads, excluded from the check. */
        observer_actor: z.string().min(1),
      })
      .strict()
      .optional(),
    sinks: z
      .array(
        z
          .object({
            tool: z.string().min(1),
            recipient_arg: z.string().min(1),
          })
          .strict(),
      )
      .optional(),
    forbidden: z
      .array(
        z
          .object({
            tool: z.string().min(1),
            ask: z.string().min(1),
          })
          .strict(),
      )
      .optional(),
    reset: operationSchema.optional(),
    outside_address: z.string().min(1),
    policy: z.array(z.string().min(1)),
    /** The agent's role, as the principal names it. */
    role: z.string().min(1).optional(),
  })
  .strict();

export type MatrixServer = z.infer<typeof matrixServerSchema>;
export type MatrixCredential = z.infer<typeof credentialSchema>;
export type MatrixCredentials = z.infer<typeof matrixCredentialsSchema>;
export type PermissionMatrix = z.infer<typeof permissionMatrixSchema>;
export type MatrixSide = keyof MatrixCredentials;

export function parseMatrix(json: unknown): PermissionMatrix {
  if (typeof json !== 'string') return permissionMatrixSchema.parse(json);
  let decoded: unknown;
  try {
    decoded = JSON.parse(json) as unknown;
  } catch (error) {
    throw new Error(`Permission matrix is not valid JSON: ${(error as Error).message}`, {
      cause: error,
    });
  }
  return permissionMatrixSchema.parse(decoded);
}

export function unconfirmed(matrix: PermissionMatrix): string[] {
  return [...matrix.unconfirmed];
}

export function assertConfirmed(matrix: PermissionMatrix): void {
  const paths = unconfirmed(matrix);
  if (paths.length === 0) return;
  throw new Error(`Permission matrix still has unconfirmed paths: ${paths.join(', ')}`);
}
