// Small response helpers.
import type { ErrorCode } from '../../src/sync/protocol';

export const json = (data: unknown, status = 200, headers?: Record<string, string>): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

export const fail = (error: ErrorCode, status: number, headers?: Record<string, string>): Response => json({ error }, status, headers);

/** Read a JSON body of at most `max` characters. Returns null when it's too big, not JSON, or not an object. */
export async function readJson(req: Request, max: number): Promise<Record<string, unknown> | 'too_large' | null> {
  const declared = Number(req.headers.get('Content-Length') ?? 0);
  if (declared > max) return 'too_large';
  const text = await req.text();
  if (text.length > max) return 'too_large';
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
