import { NextResponse } from "next/server"
import { AgentMesh } from "@agentmesh/sdk"

// Use a singleton or request-scoped instance
let mesh: AgentMesh | null = null

async function getMesh() {
  if (mesh) return mesh

  mesh = new AgentMesh({
    privateKey: process.env.PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000000",
    axlPort: 8080,
    agentName: "Dashboard-Sentry",
  })

  await mesh.connect()
  return mesh
}

export async function GET() {
  try {
    const meshInstance = await getMesh()

    // AgentMesh doesn't have getRegisteredAgents.
    // For the dashboard, we want a list of agents.
    // We'll fetch a few common capabilities to populate the list.
    const commonCapabilities = ["planning", "synthesis", "web-research", "defi-analysis"]
    const agentMap = new Map<string, any>()

    for (const cap of commonCapabilities) {
      const agents = await meshInstance.findAgents(cap)
      agents.forEach(a => agentMap.set(a.address, a))
    }

    const profiles = Array.from(agentMap.values()).map(a => ({
      name: a.name,
      status: a.available ? "available" : "offline",
      capabilities: a.capabilities,
      reputation: a.reputation.score,
    }))

    return NextResponse.json(profiles)
  } catch (e) {
    console.error("Failed to fetch agents:", e)
    return NextResponse.json({ error: "Failed to fetch agents" }, { status: 500 })
  }
}
