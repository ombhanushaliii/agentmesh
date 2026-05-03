import { NextResponse } from "next/server"
import { PlannerAgent } from "@agentmesh/agents"
import { publish } from "../../../lib/eventBus"
import type { AgentEvent } from "@agentmesh/types"

let planner: PlannerAgent | null = null
let initPromise: Promise<PlannerAgent> | null = null

async function initPlanner(): Promise<PlannerAgent> {
  const privateKey = process.env.PLANNER_PRIVATE_KEY
  const inferenceApiKey = process.env.GEMINI_API_KEY
  if (!privateKey) throw new Error("PLANNER_PRIVATE_KEY not set in .env.local")
  if (!inferenceApiKey) throw new Error("GEMINI_API_KEY not set in .env.local")

  const agent = new PlannerAgent({
    privateKey,
    axlBridgeUrl: process.env.AXL_BRIDGE_URL ?? "http://127.0.0.1:9002",
    agentName: "planner-01",
    inferenceApiKey,
  })

  agent.onAgentEvent((e: AgentEvent) => {
    const parts = [e.type, e.jobId?.slice(0, 8), e.detail].filter(Boolean)
    publish(e.agentName, parts.join(" — "))
  })

  await agent.start()
  planner = agent
  return agent
}

async function getPlanner(): Promise<PlannerAgent> {
  if (planner) return planner
  if (!initPromise) {
    initPromise = initPlanner().catch((e) => {
      initPromise = null
      throw e
    })
  }
  return initPromise
}

export async function POST(req: Request) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text))

      try {
        const { goal } = await req.json()
        const agent = await getPlanner()
        publish("planner-01", `received goal: ${goal.slice(0, 80)}`)
        const result = await agent.executeGoal(goal)
        send(result)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error("Run goal failed:", msg)
        send(`Error: ${msg}`)
      }

      controller.close()
    },
  })

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  })
}
