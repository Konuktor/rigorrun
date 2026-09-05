/**
 * An agent somebody wrote for their own desk.
 *
 * It owns its loop, it speaks MCP, and it knows nothing about RigorRun beyond
 * the ten lines at the bottom of this file. That is the point of it: if this
 * had to be reshaped to be evaluated, the evaluation would be measuring the
 * reshaping.
 *
 * The behaviour is deliberately simple and deliberately imperfect, because a
 * benchmark that only ever sees correct agents measures nothing. `careless`
 * exists so a regression has something to be a regression *from*.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface Behaviour {
  /**
   * Whether to check the deposit against the desk's limit before confirming.
   *
   * Turning this off is how the dogfood test introduces a bug on purpose.
   */
  checksTheDeposit: boolean;
}

export const CAREFUL: Behaviour = { checksTheDeposit: true };
export const CARELESS: Behaviour = { checksTheDeposit: false };

/** The desk's rule, as this team understands it. */
const SIGN_OFF_LIMIT = 500;

interface Booking {
  bookingId: string;
  depositAmount: number;
  bookingStatus: string;
  signedOffBy: string | null;
  note: string;
}

export async function runTask(
  mcpUrl: string,
  inputs: Record<string, unknown>,
  behaviour: Behaviour,
): Promise<string> {
  const client = new Client({ name: 'booking-agent', version: '1.0.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
  await client.connect(transport as never);

  try {
    const bookingId = String(inputs['bookingId'] ?? '');
    if (!bookingId) return 'No booking was named, so nothing was done.';

    const booking = await read(client, bookingId);
    if (!booking) return `Could not read ${bookingId}.`;

    if (booking.bookingStatus === 'confirmed') {
      return `${bookingId} was already confirmed; left alone.`;
    }
    if (booking.bookingStatus === 'cancelled') {
      return `${bookingId} is cancelled and cannot be confirmed.`;
    }

    // The note is written by whoever made the enquiry. It is data. Anything in
    // it that reads like an instruction is still data.
    const noise = /ignore|urgent note|policy has changed|do not record/i.test(booking.note)
      ? ' The note contained instruction-shaped text, which was not followed.'
      : '';

    if (behaviour.checksTheDeposit && booking.depositAmount > SIGN_OFF_LIMIT && !booking.signedOffBy) {
      await call(client, 'record_signoff', { bookingId, approver: 'Duty manager' });
    }

    await call(client, 'confirm_booking', { bookingId });
    return `Confirmed ${bookingId} (deposit ${booking.depositAmount}).${noise}`;
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function read(client: Client, bookingId: string): Promise<Booking | undefined> {
  const result = await call(client, 'get_booking', { bookingId });
  return result as Booking | undefined;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) return undefined;
  const structured = (result as { structuredContent?: unknown }).structuredContent;
  if (structured !== undefined) return structured;
  const first = (result.content as { type: string; text?: string }[] | undefined)?.[0];
  return first?.text ? JSON.parse(first.text) : undefined;
}
