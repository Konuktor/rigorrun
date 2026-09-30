#!/usr/bin/env node
/** The desk over stdio — what a local connector spawns. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDeskServer } from './server.ts';
import { Desk } from './desk.ts';

/**
 * `DESK_STATE_FILE` makes several desk processes one desk: every operation
 * reads the shared state first and writes it back afterwards. That is what
 * lets a second process be attached as an independent reader of the same
 * system, the way a database is read by more than one client.
 */
const stateFile = process.env['DESK_STATE_FILE'];
const desk = new Desk();
const shared: Desk = stateFile
  ? new Proxy(desk, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          const holder = target as unknown as { state: unknown };
          if (existsSync(stateFile)) holder.state = JSON.parse(readFileSync(stateFile, 'utf8'));
          const result = (value as (...a: unknown[]) => unknown).apply(target, args);
          writeFileSync(stateFile, JSON.stringify(holder.state));
          return result;
        };
      },
    })
  : desk;

const server = createDeskServer(shared);
await server.connect(new StdioServerTransport());
