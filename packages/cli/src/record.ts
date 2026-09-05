/**
 * `rigorrun record` — the loopback bridge between the browser recorder and the
 * local runner.
 *
 * Binds to 127.0.0.1 only, accepts exactly one trace, validates it against the
 * schema before it touches disk, and exits. Nothing leaves the machine.
 */
import { createServer } from 'node:http';
import { join } from 'node:path';
import { parseTrace, type WorkflowTrace } from '@rigorrun/core';
import { writeJson } from './io.ts';
import { c, heading, line } from './ui.ts';

const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** Only the extension and a locally served page may talk to this listener. */
function allowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  return (
    origin.startsWith('chrome-extension://') ||
    origin.startsWith('moz-extension://') ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  );
}

export async function receiveTrace(port: number, outPath?: string): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const origin = req.headers.origin;
      if (!allowedOrigin(origin)) {
        res.writeHead(403).end('forbidden origin');
        return;
      }

      const cors = {
        'access-control-allow-origin': origin ?? '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        vary: 'origin',
      };

      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors).end();
        return;
      }
      if (req.method === 'GET' && req.url === '/health') {
        res
          .writeHead(200, { ...cors, 'content-type': 'application/json' })
          .end(JSON.stringify({ ok: true, service: 'rigorrun-ingest' }));
        return;
      }
      if (req.method !== 'POST' || !req.url?.startsWith('/trace')) {
        res.writeHead(404, cors).end('not found');
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          res.writeHead(413, cors).end('trace too large');
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        void (async () => {
          let trace: WorkflowTrace;
          try {
            trace = parseTrace(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (error) {
            res
              .writeHead(400, { ...cors, 'content-type': 'application/json' })
              .end(JSON.stringify({ ok: false, error: (error as Error).message.slice(0, 400) }));
            return;
          }

          const target = outPath ?? join('.rigorrun', 'traces', `${trace.id}.json`);
          const written = await writeJson(target, trace);

          res
            .writeHead(200, { ...cors, 'content-type': 'application/json' })
            .end(JSON.stringify({ ok: true, traceId: trace.id, events: trace.events.length }));

          line(`${c.green('received')}  ${trace.events.length} events from ${trace.app.origin}`);
          line(`${c.grey('written')}   ${written}`);
          line();
          line(c.grey(`Next: rigorrun compile ${target} -o contract.json`));
          server.close(() => resolve(0));
        })();
      });
    });

    server.on('error', (error) => {
      line(`${c.red('error')} could not listen on 127.0.0.1:${port} — ${error.message}`);
      resolve(2);
    });

    // Loopback only: never expose the ingest port to the network.
    server.listen(port, '127.0.0.1', () => {
      heading('Waiting for a workflow trace');
      line(`${c.grey('listening')}  http://127.0.0.1:${port}/trace  (loopback only)`);
      line();
      line('1. Load the RigorRun recorder from dist/rigorrun-extension in chrome://extensions');
      line('2. Open the application you want to record and press Start recording');
      line('3. Do the job once, then press Stop and "Send to local RigorRun"');
      line();
      line(c.grey('Press Ctrl+C to stop waiting.'));
    });
  });
}
