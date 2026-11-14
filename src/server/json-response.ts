/** Stream plain JSON. The hosting adapter owns HTTP compression. */
export function jsonStreamResponse(value: unknown, request: Request): Response {
  let bytes: Uint8Array<ArrayBuffer> | null = new TextEncoder().encode(JSON.stringify(value));
  let offset = 0;
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      if (request.signal.aborted) { bytes = null; controller.error(new DOMException("Request aborted", "AbortError")); return; }
      if (!bytes || offset >= bytes.length) { bytes = null; controller.close(); return; }
      const next = Math.min(offset + 64 * 1024, bytes.length);
      controller.enqueue(bytes.subarray(offset, next));
      offset = next;
    },
    cancel() { bytes = null; },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
