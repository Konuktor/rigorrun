/**
 * Report output is untrusted by construction: it contains agent-written text
 * and customer-authored note content, including a deliberate prompt-injection
 * payload. Everything interpolated into the HTML goes through here.
 */
const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"'`]/g, (char) => ENTITIES[char] ?? char);
}

/** Pretty-prints a value and escapes it for display inside <pre>. */
export function escJson(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    text = String(value);
  }
  return esc(text.length > 4000 ? `${text.slice(0, 4000)}\n… truncated` : text);
}
