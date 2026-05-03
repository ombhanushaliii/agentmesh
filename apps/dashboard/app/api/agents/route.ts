import { NextResponse } from "next/server"
import { AgentMesh } from "@agentmesh/sdk"

let mesh: AgentMesh | null = null

async function getMesh() {
  if (mesh) return mesh

  const privateKey = process.env.PLANNER_PRIVATE_KEY
  if (!privateKey) throw new Error("PLANNER_PRIVATE_KEY not set")

  mesh = new AgentMesh({
    privateKey,
    axlBridgeUrl: process.env.AXL_BRIDGE_URL ?? "http://127.0.0.1:9002",
    agentName: "dashboard-sentry",
  })

  await mesh.connect()
  return mesh
}

export async function GET() {
  try {
    const m = await getMesh()

    const capabilities = ["planning", "synthesis", "web-research", "summarization"]
    const seen = new Map<string, any>()

    for (const cap of capabilities) {
      const agents = await m.findAgents(cap)
      agents.forEach((a) => seen.set(a.address, a))
    }

    const profiles = Array.from(seen.values()).map((a) => ({
      name: a.name,
      status: a.available ? "available" : "offline",
      capabilities: a.capabilities,
      reputation: a.reputation.score,
    }))

    return NextResponse.json(profiles)
  } catch (e) {
    console.error("Failed to fetch agents:", e)
    return NextResponse.json([])
  }
}
