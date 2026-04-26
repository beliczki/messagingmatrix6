import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { subscribe, type BroadcastEvent } from "@/lib/events";

// Spec §4.11 — SSE feed of all writes for the active client.
// Clients use this to invalidate TanStack Query keys after a peer write lands.
export async function GET(req: NextRequest) {
  const claims = await readSession(req);
  if (!claims) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const clientId = claims.cid;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (chunk: string) => controller.enqueue(enc.encode(chunk));

      // Initial hello so clients know they're connected.
      send(`event: hello\ndata: {"ok":true}\n\n`);

      const onEvent = (e: BroadcastEvent) => {
        send(`data: ${JSON.stringify(e)}\n\n`);
      };
      const unsub = subscribe(clientId, onEvent);

      const keepalive = setInterval(() => {
        // SSE comment line — keeps proxies + browsers from closing the stream.
        send(`: keepalive\n\n`);
      }, 15_000);

      const close = () => {
        clearInterval(keepalive);
        unsub();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
