/**
 * An agent RigorRun cannot start.
 *
 * Every other way in assumes RigorRun can invoke the agent: post to a URL, or
 * run a command. A great many real agents are neither. They live inside a
 * product behind a login, or in a notebook somebody runs by hand, or on
 * infrastructure that will not accept an inbound request from a laptop. Those
 * agents are not exotic — they are most of the ones a team already has — and
 * until now none of them could be benchmarked at all.
 *
 * So this inverts the direction. RigorRun prepares the world, publishes one
 * case, and waits. Whoever is driving the agent asks what to do, does it
 * through the MCP endpoint they are handed, and says when they are finished.
 * Everything else is unchanged: the same proxy, the same step budget, the same
 * evidence, and the same rule that the agent's own account of what it did is
 * displayed and never scored.
 *
 * The waiting is deliberately not a queue. One case is offered at a time, in
 * order, because the state of the system is the thing under test and two cases
 * running at once against one system means neither result means anything.
 *
 * **On the key.** A driver authenticates with a key of its own rather than the
 * runner's session token, and the difference is worth being precise about. The
 * key permits exactly three things: see the case that is waiting, say it is
 * finished, and give up on it. It does not drive the runner. It is still
 * powerful — the waiting case carries the MCP endpoint for that case, so
 * whoever holds the key can act on the system through it, which is inherent in
 * being the thing that acts on the system. It is scoped to one agent and can
 * be revoked by deleting that agent.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createProxySession, type ProxyServer } from '@rigorrun/proxy';
import type {
  AgentAdapter,
  AgentEnvironment,
  AgentRunInput,
  AgentRunOutput,
} from '@rigorrun/agents';

/** What a driver is told to do. The public half of a case, and where to do it. */
export interface WaitingCase {
  caseId: string;
  agentId: string;
  /** Which case this is, so a person watching knows how far along it is. */
  index: number;
  total: number;
  task: {
    instruction: string;
    inputs: Record<string, unknown>;
    policyBrief: string;
  };
  /** An MCP endpoint scoped to this case. It stops existing when the case does. */
  mcpUrl: string;
  expiresAt: string;
  maxSteps: number;
}

export interface Completion {
  status: 'completed' | 'failed';
  /** The driver's account of what happened. Displayed, never scored. */
  output: string;
}

interface Offer extends WaitingCase {
  settle: (completion: Completion) => void;
  timer: NodeJS.Timeout;
}

/** How long one case may wait for a person or a system that is not here yet. */
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

export function newAgentKey(): string {
  return randomBytes(32).toString('hex');
}

/** Constant-time, so a wrong key takes as long as a nearly-right one. */
export function keyMatches(given: string, expected: string): boolean {
  const left = Buffer.from(given);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * The waiting slot, one per agent.
 *
 * Lives on the runner rather than in a project file, because it describes what
 * is happening right now. A runner that is restarted has nothing waiting, which
 * is the truth: the case it was in the middle of died with it.
 */
export class ExternalDriver {
  private offers = new Map<string, Offer>();
  /** Set the first time a driver asks for work, which is what proves it exists. */
  private checkedIn = new Set<string>();
  /**
   * Agents whose current run has been given up on.
   *
   * Once one case has waited out its timeout, waiting the same again for every
   * remaining case is not patience, it is a suite that takes two hours to tell
   * you nobody was listening. The rest fail at once, with the same reason.
   */
  private abandoned = new Set<string>();

  /** What this agent's driver should be doing, or nothing. */
  current(agentId: string): WaitingCase | null {
    const offer = this.offers.get(agentId);
    if (!offer) return null;
    const { settle: _settle, timer: _timer, ...waiting } = offer;
    return waiting;
  }

  /** A driver has spoken. Recorded so the interface can stop saying "never". */
  noteCheckIn(agentId: string): void {
    this.checkedIn.add(agentId);
  }

  hasCheckedIn(agentId: string): boolean {
    return this.checkedIn.has(agentId);
  }

  /**
   * The driver says it is done.
   *
   * The case id has to match what is actually waiting. A driver that answers
   * the previous case — because it retried, or because two copies are running
   * — must not have its answer counted against this one.
   */
  finish(agentId: string, caseId: string, completion: Completion): boolean {
    const offer = this.offers.get(agentId);
    if (!offer || offer.caseId !== caseId) return false;
    offer.settle(completion);
    return true;
  }

  /** Offers one case and waits. Called by the adapter, once per case. */
  private offer(waiting: WaitingCase, timeoutMs: number): Promise<Completion> {
    if (this.abandoned.has(waiting.agentId)) {
      return Promise.resolve({
        status: 'failed',
        output: 'Nobody answered the earlier cases, so RigorRun stopped waiting for this one.',
      });
    }
    if (this.offers.has(waiting.agentId)) {
      // Two runs against one agent means two cases open against one system at
      // once, and then neither result means anything.
      return Promise.resolve({
        status: 'failed',
        output: 'This agent is already working on another run.',
      });
    }
    return new Promise<Completion>((resolve) => {
      const done = (completion: Completion): void => {
        const current = this.offers.get(waiting.agentId);
        if (current) {
          clearTimeout(current.timer);
          this.offers.delete(waiting.agentId);
        }
        resolve(completion);
      };
      const timer = setTimeout(() => {
        this.abandoned.add(waiting.agentId);
        done({ status: 'failed', output: 'Nobody answered this case before it timed out.' });
      }, timeoutMs);
      timer.unref();
      this.offers.set(waiting.agentId, { ...waiting, settle: done, timer });
    });
  }

  /** Ends whatever is waiting, for a run that is being abandoned. */
  cancel(agentId: string, why: string): void {
    this.offers.get(agentId)?.settle({ status: 'failed', output: why });
  }

  adapter(config: {
    id: string;
    name: string;
    proxy: ProxyServer;
    timeoutMs?: number;
    /** How many cases there are, so a driver can say "3 of 12". */
    total: number;
  }): AgentAdapter {
    let index = 0;
    // A new run starts patient again, whatever the last one did.
    this.abandoned.delete(config.id);
    return {
      id: config.id,
      name: config.name,
      kind: 'external',
      description: `${config.name}, driven by you through the RigorRun proxy.`,

      execute: async (input: AgentRunInput, env: AgentEnvironment): Promise<AgentRunOutput> => {
        const { server, calls } = createProxySession({
          tools: input.task.tools,
          environment: env,
        });
        const { sessionId, url: mcpUrl } = await config.proxy.publish(server);
        const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        index += 1;

        try {
          const completion = await this.offer(
            {
              caseId: input.caseId,
              agentId: config.id,
              index,
              total: config.total,
              task: {
                instruction: input.task.instruction,
                inputs: input.task.inputs,
                policyBrief: input.task.policyBrief,
              },
              mcpUrl,
              expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
              maxSteps: input.maxSteps,
            },
            timeoutMs,
          );
          return {
            report:
              completion.output ||
              `Your agent reported ${completion.status} after ${calls.length} call(s).`,
            usage: null,
            costUsd: null,
            costNote: 'cost unavailable — RigorRun did not call this agent',
          };
        } finally {
          // The endpoint stops existing whatever happened, so nothing can keep
          // touching the customer's system after the case is over.
          await config.proxy.revoke(sessionId);
        }
      },
    };
  }
}
