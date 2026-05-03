import { NextResponse } from "next/server"
import { subscribe } from "../../../lib/eventBus"

export async function GET() {
  const encoder = new TextEncoder()
  let unsub: (() => void) | null = null

  const stream = new ReadableStream({
    start(controller) {
      unsub = subscribe((event) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          // client disconnected
        }
      })
    },
    cancel() {
      unsub?.()
    },
  })

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  })
}
