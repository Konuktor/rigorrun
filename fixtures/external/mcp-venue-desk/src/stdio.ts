#!/usr/bin/env node
/** The desk over stdio — what a local connector spawns. */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDeskServer } from './server.ts';

const server = createDeskServer();
await server.connect(new StdioServerTransport());
