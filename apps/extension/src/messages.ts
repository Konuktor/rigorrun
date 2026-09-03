/**
 * The message contract between the popup, the background worker and the
 * content script. Every message is validated on receipt; a page cannot forge
 * one because content scripts run in an isolated world and the background
 * worker checks `sender`.
 */
import type { TraceEvent } from '@rigorrun/core';

export type RecorderStatus = 'idle' | 'recording' | 'paused';

export interface RecorderState {
  status: RecorderStatus;
  eventCount: number;
  droppedSensitiveEvents: number;
  startedAt: number | null;
  origin: string | null;
  title: string;
}

export type PopupMessage =
  | { type: 'recorder:start' }
  | { type: 'recorder:pause' }
  | { type: 'recorder:resume' }
  | { type: 'recorder:stop' }
  | { type: 'recorder:reset' }
  | { type: 'recorder:getState' }
  | { type: 'recorder:export' }
  | { type: 'recorder:send'; port: number };

export type ContentMessage =
  | { type: 'recorder:event'; event: Omit<TraceEvent, 'index'> }
  | { type: 'recorder:dropped' }
  | { type: 'recorder:pageInfo'; origin: string; title: string };

export const DEFAULT_STATE: RecorderState = {
  status: 'idle',
  eventCount: 0,
  droppedSensitiveEvents: 0,
  startedAt: null,
  origin: null,
  title: '',
};
