import { NextResponse } from "next/server"

export async function GET(req: Request) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (agent: string, action: string) => {
        const event = {
          timestamp: new Date().toLocaleTimeString(),
          agent,
          action,
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      // Initial burst of mock events
      sendEvent("System", "Dashboard connected")
      sendEvent("Planner-Alpha", "Waiting for goal")

      setInterval(() => {
        const agents = ["Researcher-1", "Planner-Alpha", "System"]
        const actions = ["Heartbeat", "Scanning 0G Storage", "Updating reputation"]
        sendEvent(
          agents[Math.floor(Math.random() * agents.length)],
          actions[Math.floor(Math.random() * actions.length)]
        )
      }, 5000)
    },
    cancel() {},
  })

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  })
}
