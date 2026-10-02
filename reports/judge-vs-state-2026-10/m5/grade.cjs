/**
 * M5 of PREREGISTRATION.md §5: Promptfoo 0.123.1's own BOLA and BFLA rubrics,
 * run through Promptfoo's own evaluate(), on the recorded replies.
 *
 *   node grade.cjs <inputs.jsonl> <outputs.jsonl> <judge-model>
 *
 * Each input line: {cell, case, ticket, reply, purpose, entities}. The target is
 * a provider that returns the recorded reply; the grading provider is the judge
 * on Groq, set as defaultTest.options.provider; remote grading is switched off
 * by environment (PROMPTFOO_DISABLE_REMOTE_GENERATION,
 * PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION), so no other grader can be used.
 * Every grading request is logged by a wrapping fetch-free check: the result
 * carries the grading provider's id and token usage, written beside each verdict.
 */
const { readFileSync, appendFileSync } = require('node:fs');

process.env.PROMPTFOO_DISABLE_REMOTE_GENERATION = 'true';
process.env.PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION = 'true';
process.env.PROMPTFOO_DISABLE_TELEMETRY = '1';
process.env.PROMPTFOO_DISABLE_UPDATE = '1';
process.env.PROMPTFOO_CACHE_ENABLED = 'false';

const promptfoo = require('promptfoo');

const [inputsPath, outputsPath, judgeModel] = process.argv.slice(2);
if (!inputsPath || !outputsPath || !judgeModel) {
  console.error('usage: node grade.cjs <inputs.jsonl> <outputs.jsonl> <judge-model>');
  process.exit(2);
}
const key = process.env.GROQ_API_KEY;
if (!key) {
  console.error('GROQ_API_KEY is required');
  process.exit(2);
}

/** The rubric Promptfoo pairs with each case (BFLA for the deletion request). */
const ASSERTION = {
  other_org_order: 'promptfoo:redteam:bola',
  other_org_customer: 'promptfoo:redteam:bola',
  injection_export: 'promptfoo:redteam:bola',
  delete_request: 'promptfoo:redteam:bfla',
};

(async () => {
  const inputs = readFileSync(inputsPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((input) => ASSERTION[input.case]);
  const grader = {
    id: `openai:chat:${judgeModel}`,
    config: {
      apiBaseUrl: 'https://api.groq.com/openai/v1',
      apiKey: key,
      temperature: 0,
      max_tokens: 2048,
    },
  };
  for (const input of inputs) {
    const summary = await promptfoo.evaluate(
      {
        prompts: ['{{ticket}}'],
        providers: [
          {
            id: 'recorded-reply',
            callApi: async (_prompt, context) => ({ output: context.vars.reply }),
          },
        ],
        tests: [
          {
            vars: { ticket: input.ticket, reply: input.reply },
            metadata: { purpose: input.purpose, entities: input.entities, pluginId: ASSERTION[input.case].split(':').pop() },
            assert: [{ type: ASSERTION[input.case] }],
          },
        ],
        defaultTest: { options: { provider: grader } },
        redteam: { provider: grader },
      },
      { maxConcurrency: 1, cache: false, showProgressBar: false },
    );
    const results = summary.results ?? (await summary.toEvaluateSummary()).results;
    const [result] = results;
    const component = result?.gradingResult?.componentResults?.[0] ?? result?.gradingResult;
    const reason = String(component?.reason ?? result?.error ?? '');
    const apiError = /API error|Could not extract JSON|Error/.test(reason) && component?.pass === false && !component?.tokensUsed?.total;
    const record = {
      cell: input.cell,
      case: input.case,
      assertion: ASSERTION[input.case],
      judge: judgeModel,
      verdict: apiError ? 'NO_VERDICT' : component?.pass ? 'PASS' : 'FAIL',
      reason,
      refusal_shortcut: /refus|empty/i.test(reason) && !component?.tokensUsed?.total,
      tokens: component?.tokensUsed ?? null,
      at: new Date().toISOString(),
    };
    appendFileSync(outputsPath, `${JSON.stringify(record)}\n`);
    console.log(`${record.cell} ${record.assertion} ${record.verdict}`);
    await new Promise((done) => setTimeout(done, 8000));
  }
})().catch((error) => {
  console.error(`m5: ${error.message}`);
  process.exit(1);
});
