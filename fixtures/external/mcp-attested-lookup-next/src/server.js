/**
 * A test fixture that lies, the way real servers lie: by accident.
 *
 * `lookup_user` is annotated `readOnlyHint: true`. It also appends a line to
 * an audit file every time it is called. Nothing about the source looks
 * malicious, and that is the point — this is what gets written when "we should
 * log lookups for compliance" meets "this tool obviously only reads". The
 * annotation was true when it was written and became false in a later commit,
 * and nobody changed the annotation because nothing checks it.
 *
 * The write is invisible from outside the process. `list_users` cannot see it,
 * so a verifier that reads state only through the server's own tools finds
 * nothing at all. Reading the container's filesystem is the only thing that
 * catches it, which is the entire argument for the container harness.
 *
 * `list_users` is genuinely read-only and correctly annotated, so a harness
 * that simply flagged everything would fail against this fixture too.
 *
 * VERSION B. Byte-identical to version A except for one thing: `lookup_user`
 * now also writes `last-seen.json`. Same tool name, same input schema, same
 * annotations, same description, same version of the same package name to any
 * consumer reading metadata. The only difference is a side effect, which is
 * exactly the change that a schema diff, a description diff and a version bump
 * all miss, and which two verification records will show.
 *
 * Imports nothing from RigorRun, enforced by packages/mcp/test/external.test.ts.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const USERS = [
  { userId: 'u-1001', displayName: 'Ada', department: 'platform' },
  { userId: 'u-1002', displayName: 'Grace', department: 'security' },
  { userId: 'u-1003', displayName: 'Alan', department: 'platform' },
];

function payload(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

export function createServer() {
  const server = new McpServer({ name: 'attested-lookup', version: '2.0.0' });

  server.registerTool(
    'lookup_user',
    {
      description: 'Look up a single user by id.',
      inputSchema: { userId: z.string() },
      annotations: {
        title: 'Look up a user',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ userId }) => {
      // The compliance requirement, added later, by somebody who did not think
      // of it as a write because it is not the user record.
      appendFileSync('audit.log', `${new Date(0).toISOString()} lookup ${userId}\n`);

      // The new side effect. One file, added between releases.
      writeFileSync('last-seen.json', JSON.stringify({ userId }));

      const user = USERS.find((u) => u.userId === userId);
      return payload(user ?? { userId, found: false });
    },
  );

  server.registerTool(
    'list_users',
    {
      description: 'List every user.',
      inputSchema: {},
      annotations: {
        title: 'List users',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    () => payload({ users: USERS }),
  );

  return server;
}
