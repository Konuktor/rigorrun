/**
 * Selector ranking for the recorder.
 *
 * A recorded workflow is only useful if it can be understood and replayed
 * later, which means the selectors it stores have to survive a redeploy. The
 * ranking is therefore by *durability*, not by convenience:
 *
 *   data-testid  →  a stable id  →  role + accessible name  →  label
 *   →  placeholder  →  visible text  →  a CSS path as a last resort
 *
 * This module is deliberately pure: it takes facts about an element rather than
 * an element, so the same ranking runs in the extension, in tests and anywhere
 * else without a DOM.
 */
import type { SelectorCandidate } from './trace.ts';

export interface ElementFacts {
  tagName: string;
  testId?: string | undefined;
  id?: string | undefined;
  name?: string | undefined;
  role?: string | undefined;
  accessibleName?: string | undefined;
  label?: string | undefined;
  placeholder?: string | undefined;
  inputType?: string | undefined;
  text?: string | undefined;
  /** CSS path computed by the caller, used only as a fallback. */
  domPath?: string | undefined;
}

/**
 * Ids that a framework generated are worse than no id at all: they change on
 * every render, so a selector built from one is guaranteed to rot.
 */
export function looksStableId(id: string): boolean {
  if (id.length === 0 || id.length > 64) return false;
  if (/^:[a-z0-9]+:$/i.test(id)) return false; // React useId
  if (/^(radix|headlessui|mui|ember|ext-gen|downshift)[-:]/i.test(id)) return false;
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(id)) return false; // uuid
  if (/\d{4,}/.test(id)) return false; // long numeric run
  if (/^[a-z]+-\d+$/i.test(id)) return false; // el-42, input-7
  return /^[A-Za-z][\w-]*$/.test(id);
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

/** Ranked candidates, best first. Never empty — there is always a fallback. */
export function rankSelectors(facts: ElementFacts): SelectorCandidate[] {
  const candidates: SelectorCandidate[] = [];

  if (facts.testId) {
    candidates.push({
      strategy: 'test_id',
      value: `[data-testid="${cssEscape(facts.testId)}"]`,
      score: 100,
    });
  }

  if (facts.id && looksStableId(facts.id)) {
    candidates.push({ strategy: 'stable_id', value: `#${facts.id}`, score: 90 });
  }

  if (facts.role && facts.accessibleName) {
    candidates.push({
      strategy: 'role_name',
      value: `role=${facts.role}[name="${cssEscape(facts.accessibleName)}"]`,
      score: 78,
    });
  }

  if (facts.label) {
    candidates.push({ strategy: 'label', value: `label=${facts.label}`, score: 70 });
  }

  if (facts.placeholder) {
    candidates.push({
      strategy: 'placeholder',
      value: `placeholder=${facts.placeholder}`,
      score: 60,
    });
  }

  if (facts.text && facts.text.length <= 60) {
    candidates.push({ strategy: 'text', value: `text=${facts.text}`, score: 50 });
  }

  if (facts.name) {
    candidates.push({
      strategy: 'css',
      value: `${facts.tagName.toLowerCase()}[name="${cssEscape(facts.name)}"]`,
      score: 45,
    });
  }

  if (facts.domPath) {
    candidates.push({ strategy: 'css', value: facts.domPath, score: 20 });
  }

  if (candidates.length === 0) {
    candidates.push({ strategy: 'css', value: facts.tagName.toLowerCase(), score: 5 });
  }

  // Stable sort by score so equal-scoring candidates keep their declared order.
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => b.candidate.score - a.candidate.score || a.index - b.index)
    .map(({ candidate }) => candidate)
    .slice(0, 8);
}

/** The single best selector, plus the strategy that produced it. */
export function bestSelector(facts: ElementFacts): {
  selector: string;
  strategy: SelectorCandidate['strategy'];
  candidates: SelectorCandidate[];
} {
  const candidates = rankSelectors(facts);
  const best = candidates[0]!;
  return { selector: best.value, strategy: best.strategy, candidates };
}
