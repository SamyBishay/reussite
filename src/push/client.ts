// The relay's push endpoints (docs/dev/push.md), as the app calls them. `fetch` is injectable.
import {
  pushPath, type PushErrorCode, type PushItem, type PushRegisterRequest, type PushScheduleRequest, type PushScheduleResponse, type PushSendRequest, type PushSendResponse,
} from './protocol';

export type PushFailure = PushErrorCode | 'network' | 'rate_limited' | 'bad_request' | 'unauthorized' | 'error';

export class PushError extends Error {
  constructor(public status: number, public code: PushFailure) { super(`push ${status} ${code}`); }
}

export class PushRelay {
  private base: string;
  constructor(baseUrl: string, private pid: string, private secret: string, private fetchFn: typeof fetch = (...a) => fetch(...a)) {
    this.base = baseUrl.replace(/\/+$/, '');
  }

  private async call<T>(method: string, tail: '' | 'schedule' | 'send', body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(this.base + pushPath(this.pid, tail), {
        method,
        headers: { Authorization: 'Bearer ' + this.secret, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new PushError(0, 'network');
    }
    if (!res.ok) {
      const e = (await res.json().catch(() => null)) as { error?: PushFailure } | null;
      throw new PushError(res.status, e?.error ?? (res.status === 429 ? 'rate_limited' : 'error'));
    }
    return (await res.json()) as T;
  }

  register(endpoint: string): Promise<unknown> {
    const body: PushRegisterRequest = { endpoint };
    return this.call('PUT', '', body);
  }
  schedule(items: PushItem[], keep: string[]): Promise<PushScheduleResponse> {
    const body: PushScheduleRequest = { items, keep };
    return this.call('PUT', 'schedule', body);
  }
  send(blob: string): Promise<PushSendResponse> {
    const body: PushSendRequest = { blob };
    return this.call('POST', 'send', body);
  }
  remove(): Promise<unknown> { return this.call('DELETE', ''); }
}
