/**
 * Popup UI. Deliberately plain: start, pause, stop, a live event counter, and
 * two ways to get the trace out — a file, or a POST to the local runner.
 */
import type { RecorderState } from './messages.ts';

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
};

const statusDot = el('status-dot');
const statusText = el('status-text');
const counter = el('counter');
const dropped = el('dropped');
const origin = el('origin');
const startBtn = el<HTMLButtonElement>('start');
const pauseBtn = el<HTMLButtonElement>('pause');
const stopBtn = el<HTMLButtonElement>('stop');
const exportBtn = el<HTMLButtonElement>('export');
const sendBtn = el<HTMLButtonElement>('send');
const resetBtn = el<HTMLButtonElement>('reset');
const portInput = el<HTMLInputElement>('port');
const note = el('note');

async function ask<T = unknown>(message: unknown): Promise<T> {
  return (await chrome.runtime.sendMessage(message)) as T;
}

function render(state: RecorderState): void {
  statusText.textContent =
    state.status === 'recording' ? 'Recording' : state.status === 'paused' ? 'Paused' : 'Idle';
  statusDot.dataset['status'] = state.status;
  counter.textContent = String(state.eventCount);
  dropped.textContent = String(state.droppedSensitiveEvents);
  origin.textContent = state.origin ?? 'no page yet';

  startBtn.hidden = state.status === 'recording';
  startBtn.textContent = state.status === 'paused' ? 'Resume' : 'Start recording';
  pauseBtn.hidden = state.status !== 'recording';
  stopBtn.disabled = state.status === 'idle' && state.eventCount === 0;
  exportBtn.disabled = state.eventCount === 0;
  sendBtn.disabled = state.eventCount === 0;
}

async function refresh(): Promise<void> {
  const response = await ask<{ state: RecorderState }>({ type: 'recorder:getState' });
  render(response.state);
}

startBtn.addEventListener('click', async () => {
  const state = await ask<{ state: RecorderState }>({ type: 'recorder:getState' });
  const type = state.state.status === 'paused' ? 'recorder:resume' : 'recorder:start';
  const response = await ask<{ state: RecorderState }>({ type });
  render(response.state);
  note.textContent = 'Recording. Do the job once, then press Stop.';
});

pauseBtn.addEventListener('click', async () => {
  const response = await ask<{ state: RecorderState }>({ type: 'recorder:pause' });
  render(response.state);
});

stopBtn.addEventListener('click', async () => {
  const response = await ask<{ state: RecorderState }>({ type: 'recorder:stop' });
  render(response.state);
  note.textContent = 'Stopped. Export the trace or send it to the local runner.';
});

resetBtn.addEventListener('click', async () => {
  const response = await ask<{ state: RecorderState }>({ type: 'recorder:reset' });
  render(response.state);
  note.textContent = 'Cleared.';
});

exportBtn.addEventListener('click', async () => {
  const response = await ask<{ trace: unknown }>({ type: 'recorder:export' });
  const blob = new Blob([JSON.stringify(response.trace, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'rigorrun-trace.json';
  anchor.click();
  URL.revokeObjectURL(url);
  note.textContent = 'Trace downloaded.';
});

sendBtn.addEventListener('click', async () => {
  const port = Number(portInput.value) || 8787;
  note.textContent = `Sending to 127.0.0.1:${port}…`;
  const response = await ask<{ ok: boolean; error?: string }>({ type: 'recorder:send', port });
  note.textContent = response.ok
    ? 'Sent. Run `rigorrun compile` next.'
    : `Could not reach the local runner: ${response.error ?? 'unknown error'}. Is \`rigorrun record\` running?`;
});

void refresh();
setInterval(() => void refresh(), 1000);
