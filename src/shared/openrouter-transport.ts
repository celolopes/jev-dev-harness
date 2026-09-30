import { setTimeout as delay } from "node:timers/promises";

export class OpenRouterHTTPError extends Error {
  constructor(public readonly status: number) {
    // Never include response bodies: upstream errors may echo private state.
    super(`OpenRouter HTTP ${status}`);
    this.name = "OpenRouterHTTPError";
  }
}

/** One shared deadline covers fetch, body parsing, backoff and retries. */
export async function requestOpenRouter(
  url: string,
  apiKey: string,
  payload: unknown,
  signal: AbortSignal,
  deadline: number,
  maxRetries: number,
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/celolopes/jev-dev-harness",
        "X-OpenRouter-Title": "Jev Developer Harness",
      },
      body: JSON.stringify(payload),
      signal,
    });
    if (response.ok) return await response.json();
    await response.body?.cancel();
    const error = new OpenRouterHTTPError(response.status);
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= maxRetries) throw error;
    const retryAfter = response.headers.get("retry-after");
    const seconds = retryAfter === null ? NaN : Number(retryAfter);
    const headerDelay = Number.isFinite(seconds)
      ? seconds * 1000
      : retryAfter ? Date.parse(retryAfter) - Date.now() : NaN;
    const waitMs = Math.max(0, Number.isFinite(headerDelay) ? headerDelay : 200);
    if (Date.now() + waitMs >= deadline) throw error;
    await delay(waitMs, undefined, { signal });
  }
}
