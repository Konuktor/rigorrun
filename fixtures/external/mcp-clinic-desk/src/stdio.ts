#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ClinicDb } from './db.ts';
import { createClinicServer } from './server.ts';

const db = new ClinicDb();
const principal = db.authenticate(process.env['CLINIC_API_KEY']);
const server = createClinicServer(principal, db);
await server.connect(new StdioServerTransport());
