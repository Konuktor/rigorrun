/**
 * What a person, or an agent, can do in a browser.
 *
 * A fixed set rather than a discovered one, because a web page publishes no
 * catalogue of its capabilities the way an MCP server or an OpenAPI document
 * does. These are the actions, and the *selectors* are the arguments.
 *
 * Two decisions worth stating.
 *
 * **Selectors are data, never code.** A locator arrives as a role and a name, a
 * label, a test id or a text string — never as an expression. `page.evaluate`
 * is not exposed at all, by anything, which is what keeps "RigorRun never
 * evaluates code from data" true in a package whose entire job is driving a
 * JavaScript engine.
 *
 * **Nothing here is `readOnly` except reading.** `navigate` is not: a GET to a
 * URL with a token in it can change a great deal, and a page that runs script
 * on load can change more. Only `read_page` and `screenshot` are marked as
 * looking, and even those are a person's decision to confirm.
 */
import type { ActionDefinition } from '@rigorrun/environment';

/** How to find something on the page. One of these, never an expression. */
export interface Locator {
  role?: string;
  name?: string;
  label?: string;
  testId?: string;
  text?: string;
  /** A CSS selector. Still data — it cannot express behaviour. */
  css?: string;
}

export const BROWSER_ACTIONS: readonly ActionDefinition[] = [
  {
    name: 'navigate',
    description: 'Go to a URL within the site under test.',
    params: [{ name: 'url', type: 'string', required: true }],
    mutates: [],
    // Deliberately not read-only. A GET can do anything the server decides.
    readOnly: false,
    enforcement: 'none',
  },
  {
    name: 'click',
    description: 'Click something, found by role and name, label, test id or text.',
    params: [{ name: 'selector', type: 'string', required: true }],
    mutates: [],
    readOnly: false,
    enforcement: 'none',
  },
  {
    name: 'fill',
    description: 'Type into a field.',
    params: [
      { name: 'selector', type: 'string', required: true },
      { name: 'value', type: 'string', required: true },
    ],
    mutates: [],
    readOnly: false,
    enforcement: 'none',
  },
  {
    name: 'select',
    description: 'Choose an option in a dropdown.',
    params: [
      { name: 'selector', type: 'string', required: true },
      { name: 'value', type: 'string', required: true },
    ],
    mutates: [],
    readOnly: false,
    enforcement: 'none',
  },
  {
    name: 'press',
    description: 'Press a key, such as Enter.',
    params: [{ name: 'key', type: 'string', required: true }],
    mutates: [],
    readOnly: false,
    enforcement: 'none',
  },
  {
    name: 'read_page',
    description: 'What is on the page now: its roles, names and field values.',
    params: [],
    mutates: [],
    readOnly: true,
    enforcement: 'none',
  },
  {
    name: 'screenshot',
    description: 'A picture of the page, kept as evidence.',
    params: [],
    mutates: [],
    readOnly: true,
    enforcement: 'none',
  },
] as const;

/**
 * Reads a selector, which arrives as JSON or as a plain string.
 *
 * A bare string is treated as text to look for, because that is what somebody
 * types when they are not thinking about selectors — which is most of the time,
 * and is the right thing to optimise for.
 */
export function parseLocator(raw: unknown): Locator {
  if (typeof raw !== 'string') return typeof raw === 'object' && raw ? (raw as Locator) : {};
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return { text: trimmed };
  try {
    return JSON.parse(trimmed) as Locator;
  } catch {
    return { text: trimmed };
  }
}
