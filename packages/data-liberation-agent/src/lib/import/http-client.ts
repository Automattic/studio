/**
 * Shared HTTP utilities for REST API clients.
 * Uses bare `fetch()` (not imported) so test mocks on globalThis.fetch work.
 */

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Extract the best error message from a failed HTTP response.
 * Reads the body once as text, then tries to parse JSON for a `.message` field.
 */
export async function extractErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const json = JSON.parse(text);
    return json.message || text;
  } catch {
    return text;
  }
}

/**
 * Make an HTTP request that returns parsed JSON.
 * Handles retries on 429 with Retry-After header support.
 * Throws HttpError on final failure.
 */
export async function httpJson(
  url: string,
  options: {
    method?: string;
    headers: Record<string, string>;
    body?: BodyInit;
    timeout?: number;
    maxRetries?: number;
    retryDelay?: number;
    errorPrefix?: string;
  },
): Promise<any> {
  const maxRetries = options.maxRetries ?? 3;
  const retryDelay = options.retryDelay ?? 1000;
  const prefix = options.errorPrefix ?? '';
  const timeout = options.timeout ?? 30000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: options.headers,
      body: options.body,
      signal: AbortSignal.timeout(timeout),
    });

    if (response.ok) {
      return response.json();
    }

    // Retry on 429 (rate limited)
    if (response.status === 429 && attempt < maxRetries) {
      const retryAfter = parseInt(response.headers.get('Retry-After') ?? '1', 10);
      const waitMs = retryDelay === 0 ? 0 : Math.max(retryAfter * 1000, retryDelay);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }

    const message = await extractErrorMessage(response);
    throw new HttpError(response.status, `${prefix}${response.status}: ${message}`);
  }

  throw new HttpError(0, `${prefix}Max retries exceeded`);
}

/**
 * Make a raw HTTP request with timeout. Returns the Response object.
 * Caller is responsible for checking response.ok and reading the body.
 */
export async function httpFetch(
  url: string,
  options: {
    method?: string;
    headers: Record<string, string>;
    body?: BodyInit;
    timeout?: number;
  },
): Promise<Response> {
  return fetch(url, {
    method: options.method || 'GET',
    headers: options.headers,
    body: options.body,
    signal: AbortSignal.timeout(options.timeout ?? 30000),
  });
}
