// @ts-check
/**
 * The model behind the agent: Gemini's generateContent, or any endpoint that speaks OpenAI's chat
 * completions (OpenAI, a local Ollama, vLLM). Each is a conversation with two methods, `next()` for
 * the model's next turn and `answer(calls, results)` to hand back what the tools returned, so the
 * agent's loop is the same whichever model runs it.
 *
 * Nothing here knows about Stripe or tickets. If your agent already has an SDK, this is the file
 * you replace.
 */

/** @typedef {{ name: string, description: string, parameters: object }} Tool */
/** @typedef {{ id?: string, name: string, args: Record<string, any> | null }} Call */
/** @typedef {{ calls: Call[], text: string, stop?: string }} Turn  one reply from the model */
/** @typedef {(kind: string, data: object) => void} Log */
/** @typedef {{ next(): Promise<Turn>, answer(calls: Call[], results: unknown[]): void }} Chat */
/**
 * @typedef {object} ChatConfig
 * @property {'gemini' | 'openai'} provider
 * @property {string} model
 * @property {string} [apiKey]  sent as a header, never logged
 * @property {string} [baseUrl]
 * @property {number} [minIntervalMs]  the least time between two requests, across all chats
 */

/**
 * @param {ChatConfig} config @param {string} system @param {Tool[]} tools
 * @param {string} firstTurn @param {Log} log
 * @returns {Chat}
 */
export function openChat(config, system, tools, firstTurn, log) {
  return (config.provider === 'gemini' ? gemini : openai)(config, system, tools, firstTurn, log);
}

/**
 * Gemini's generateContent with function declarations, at temperature 0. The model's turn joins
 * the history exactly as it came back: Gemini 3 models sign their function calls
 * (`thoughtSignature` on the part) and answer 400 if a signed part is dropped or rebuilt.
 * @param {ChatConfig} config @param {string} system @param {Tool[]} tools
 * @param {string} firstTurn @param {Log} log
 * @returns {Chat}
 */
function gemini(config, system, tools, firstTurn, log) {
  const model = encodeURIComponent(config.model.replace(/^models\//, ''));
  const base = config.baseUrl ?? 'https://generativelanguage.googleapis.com';
  const url = new URL(`/v1beta/models/${model}:generateContent`, base);
  const headers = { 'x-goog-api-key': String(config.apiKey) };
  /** @type {any[]} */
  const contents = [{ role: 'user', parts: [{ text: firstTurn }] }];
  return {
    async next() {
      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools: [{ functionDeclarations: tools }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        generationConfig: { temperature: 0 },
      };
      const reply = await post(config, url, headers, body, log);
      const candidate = reply.candidates?.[0];
      if (!candidate) {
        throw new Error(
          `Gemini returned no candidate (${reply.promptFeedback?.blockReason ?? 'no reason'}).`,
        );
      }
      if (candidate.content) contents.push(candidate.content);
      /** @type {any[]} */
      const parts = candidate.content?.parts ?? [];
      return {
        calls: parts
          .filter((part) => part.functionCall)
          .map(({ functionCall: f }) => ({ id: f.id, name: f.name, args: f.args ?? {} })),
        text: parts
          .filter((part) => typeof part.text === 'string' && !part.thought)
          .map((part) => part.text)
          .join('')
          .trim(),
        stop: candidate.finishReason,
      };
    },
    // All results in one user turn after all the calls: Gemini refuses them interleaved.
    answer(calls, results) {
      const parts = calls.map(({ id, name }, i) => ({
        functionResponse: { ...(id && { id }), name, response: results[i] },
      }));
      contents.push({ role: 'user', parts });
    },
  };
}

/**
 * OpenAI's chat completions with tools, at temperature 0: the same prompt and tools as Gemini
 * gets, in a different wire format.
 * @param {ChatConfig} config @param {string} system @param {Tool[]} tools
 * @param {string} firstTurn @param {Log} log
 * @returns {Chat}
 */
function openai(config, system, tools, firstTurn, log) {
  const url = new URL('chat/completions', `${String(config.baseUrl).replace(/\/$/, '')}/`);
  /** @type {Record<string, string>} */
  const headers = config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {};
  /** @type {any[]} */
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: firstTurn },
  ];
  const functions = tools.map((tool) => ({ type: 'function', function: tool }));
  const args = (/** @type {unknown} */ raw) =>
    typeof raw === 'string' ? parseJson(raw || '{}', null) : (raw ?? {});
  return {
    async next() {
      const body = {
        model: config.model,
        messages,
        tools: functions,
        tool_choice: 'auto',
        temperature: 0,
      };
      const choice = (await post(config, url, headers, body, log)).choices?.[0];
      if (!choice?.message) throw new Error('The model returned no choice.');
      messages.push(choice.message);
      return {
        calls: (choice.message.tool_calls ?? []).map((/** @type {any} */ call) => ({
          id: call.id,
          name: call.function?.name,
          args: args(call.function?.arguments),
        })),
        text: typeof choice.message.content === 'string' ? choice.message.content.trim() : '',
        stop: choice.finish_reason,
      };
    },
    answer(calls, results) {
      calls.forEach(({ id }, i) =>
        messages.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(results[i]) }),
      );
    },
  };
}

/** @param {string} text @param {unknown} otherwise */
function parseJson(text, otherwise) {
  try {
    return JSON.parse(text);
  } catch {
    return otherwise;
  }
}

const sleep = (/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms));
let nextSlot = 0;

/**
 * One model request: paced `minIntervalMs` apart across every chat in the process, and retried on
 * 429 and 503 after the wait the provider asks for (Retry-After seconds, or Gemini's RetryInfo), else a
 * doubling backoff. Anything else that is not a 2xx throws: a model that could not be reached is a
 * harness failure, never a verdict about the agent.
 * @param {ChatConfig} config @param {URL} url @param {Record<string, string>} headers
 * @param {object} body @param {Log} log
 * @returns {Promise<any>}
 */
async function post(config, url, headers, body, log) {
  for (let attempt = 0; ; attempt++) {
    const slot = Math.max(Date.now(), nextSlot);
    nextSlot = slot + (config.minIntervalMs ?? 0);
    while (Date.now() < slot) await sleep(slot - Date.now());
    log('llm_request', { url: url.href, attempt, body });
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    const text = await response.text();
    const reply = parseJson(text, { unparsed: text.slice(0, 4000) });
    log('llm_response', { status: response.status, attempt, body: reply });
    if (response.ok) return reply;

    const retryAfter = Number(response.headers.get('retry-after') ?? NaN);
    const retryInfo = reply?.error?.details?.find((/** @type {any} */ d) => d?.retryDelay);
    const wait = Number.isFinite(retryAfter)
      ? retryAfter * 1000
      : retryInfo
        ? parseFloat(retryInfo.retryDelay) * 1000
        : 1000 * 2 ** attempt;
    // Two minutes or more is a spent daily quota, not a busy minute: give up and say so.
    if ((response.status === 429 || response.status === 503) && attempt < 5 && wait < 120_000) {
      await sleep(wait);
      continue;
    }
    const detail = reply?.error?.message ?? text.slice(0, 200);
    throw new Error(`${config.provider} answered ${response.status}: ${detail}`);
  }
}
