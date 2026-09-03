/**
 * D1 helpers.
 *
 * Every query here is bounded and hits an index. On the free plan rows read is
 * the metric that matters, so an unbounded `SELECT *` is not a style problem,
 * it is how a free deployment turns into a bill.
 */
import type { Env } from './types.ts';

export const MAX_PAGE = 100;

export async function touchWorkspace(env: Env, workspaceId: string, now: string): Promise<void> {
  await env.DB.prepare('UPDATE workspaces SET last_seen_at = ?1 WHERE id = ?2')
    .bind(now, workspaceId)
    .run();
}

/**
 * A fixed-window limiter backed by D1. It is coarse and it is not distributed-
 * safe to the millisecond, which is fine: it exists to stop accidental abuse of
 * a free service, not to be a billing meter.
 */
export async function checkRateLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number,
  now = Date.now(),
): Promise<{ allowed: boolean; remaining: number; resetSeconds: number }> {
  const windowStart = Math.floor(now / 1000 / windowSeconds) * windowSeconds;

  const row = await env.DB.prepare('SELECT window_start, count FROM rate_limits WHERE key = ?1')
    .bind(key)
    .first<{ window_start: number; count: number }>();

  if (!row || row.window_start !== windowStart) {
    await env.DB.prepare(
      'INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1) ' +
        'ON CONFLICT(key) DO UPDATE SET window_start = ?2, count = 1',
    )
      .bind(key, windowStart)
      .run();
    return { allowed: true, remaining: limit - 1, resetSeconds: windowSeconds };
  }

  if (row.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetSeconds: windowStart + windowSeconds - Math.floor(now / 1000),
    };
  }

  await env.DB.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?1').bind(key).run();
  return {
    allowed: true,
    remaining: limit - row.count - 1,
    resetSeconds: windowStart + windowSeconds - Math.floor(now / 1000),
  };
}

/** Removes expired reports. Called opportunistically, so storage stays bounded. */
export async function purgeExpiredReports(env: Env, now: string): Promise<number> {
  const result = await env.DB.prepare('DELETE FROM published_reports WHERE expires_at < ?1')
    .bind(now)
    .run();
  return result.meta?.changes ?? 0;
}
