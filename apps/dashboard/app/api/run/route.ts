import { NextResponse } from "next/server"
import { PlannerAgent } from "@agentmesh/agents"

export async function POST(req: Request) {
  try {
    const { goal } = await req.json()

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (agent: string, action: string) => {
          const event = {
            timestamp: new Date().toLocaleTimeString(),
            agent,
            action,
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        }

        // Initialize PlannerAgent with required config
        const planner = new PlannerAgent({
          privateKey: process.env.PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000000",
          axlPort: 8080,
          agentName: "Planner-Alpha",
          computeApiKey: process.env.GEMINI_API_KEY,
        })

        await planner.start()

        // PlannerAgent.executeGoal implementation uses console.log for events
        // In a real production build, we'd inject a callback or use an EventEmitter
        // For the hackathon, we use the returned final result and simulate the events

        sendEvent("Planner-Alpha", `Received goal: ${goal}`)
        await new Promise(r => setTimeout(r, 1000))
        sendEvent("Planner-Alpha", "Decomposing goal into sub-jobs...")
        await new Promise(r => setTimeout(r, 1500))

        const finalResult = await planner.executeGoal(goal)

        sendEvent("Planner-Alpha", "Synthesizing final answer...")
        await new Promise(r => setTimeout(r, 1000))

        controller.enqueue(encoder.encode(finalResult))
        controller.close()

        await planner.stop()
      },
    })

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    })
  } catch (e) {
    console.error("Run goal failed:", e)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
