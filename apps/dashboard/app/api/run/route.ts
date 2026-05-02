import { NextResponse } from "next/server"

export async function POST(req: Request) {
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

      sendEvent("Planner-Alpha", `Received goal: ${goal}`)
      await new Promise(r => setTimeout(r, 1000))
      sendEvent("Planner-Alpha", "Decomposing goal into sub-jobs...")
      await new Promise(r => setTimeout(r, 1500))
      sendEvent("Researcher-1", "Executing DeFi analysis...")
      await new Promise(r => setTimeout(r, 2000))
      sendEvent("Researcher-1", "Uploading result to 0G Storage")
      await new Promise(r => setTimeout(r, 1000))
      sendEvent("Planner-Alpha", "Synthesizing final answer...")
      await new Promise(r => setTimeout(r, 1000))

      // Final result as a plain string chunk for the reader
      controller.enqueue(encoder.encode("Based on the analysis of the 0G chain and liquid staking protocols, the top risks include liquidity mismatch, smart contract vulnerabilities in the staking layer, and regulatory uncertainty surrounding LSTs."))

      controller.close()
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
