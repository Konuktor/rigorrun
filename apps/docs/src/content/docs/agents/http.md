---
title: An HTTP agent
description: Answer one health request and one task request. If your agent already speaks MCP, that plus about ten lines is the whole integration.
---

RigorRun posts each task to your endpoint and waits for an answer.

## The two requests

Your agent has to answer a small health request saying it is there, which is what the **Check it
answers** button in the interface calls, and then a task request per case.

```ts
import { createServer } from 'node:http';

createServer(async (req, res) => {
  if (req.method === 'GET') {
    // "I am here." This is what RigorRun probes before a run.
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  const body = JSON.parse(await text(req));
  // body.task is the job, in the words from the project.
  // body.tools is what this case allows.
  // body.url is the endpoint to call tools through.
  const report = await yourAgent(body.task, body.tools, body.url);

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ report }));
}).listen(7801);

const text = (req: NodeJS.ReadableStream) =>
  new Promise<string>((resolve) => {
    let out = '';
    req.on('data', (chunk) => (out += chunk));
    req.on('end', () => resolve(out));
  });
```

`report` is free text. It is shown on the result and never scored.

## Timeouts

Each case has a step budget and a time budget. An agent that stops answering ends that case with
`It ended early` rather than hanging the run.

## If it already speaks MCP

RigorRun exposes the case's tools over MCP at the URL it hands you. An agent that already knows how
to call MCP tools needs the wrapper above and nothing else.
