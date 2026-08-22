// Bound every shared outbound request so a provider or internal Supabase call
// cannot occupy an Edge invocation indefinitely. A caller-provided signal is
// preserved by forwarding its abort into the timeout controller.
export async function fetchWithTimeout(
  input: string | URL | Request,
  options: RequestInit = {},
  timeoutMs = 12_000,
): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = options.signal;
  const abortFromCaller = () => controller.abort();
  if (callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const response = await fetch(input, { ...options, signal: controller.signal });
    // fetch() resolves as soon as the headers arrive. Keep the same timeout
    // active while the body is consumed as well, otherwise a provider can
    // send headers and then hold an Edge invocation open indefinitely while a
    // caller waits in response.json()/response.text(). All current shared
    // callers use bounded JSON/text payloads, so buffering is intentional.
    const body = await response.arrayBuffer();
    // Fetch can return null-body statuses. Passing even an empty ArrayBuffer
    // to Response for these statuses throws, so preserve their bodyless shape
    // after the stream has been fully consumed.
    const responseBody = [204, 205, 304].includes(response.status) ? null : body;
    return new Response(responseBody, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    });
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  }
}
