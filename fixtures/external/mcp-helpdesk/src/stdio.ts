#!/usr/bin/env node
/** Larch Helpdesk over stdio. The principal is fixed when the process starts. */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { helpdeskDb } from './db.ts';
import { createHelpdeskServer } from './server.ts';

const principal = helpdeskDb.principalFor(process.env['LARCH_TOKEN']);
const server = createHelpdeskServer(principal);
await server.connect(new StdioServerTransport());
