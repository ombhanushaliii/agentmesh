import { NextResponse } from "next/server"

export async function GET() {
  // Mock agents - will wire to 0G Storage KV later
  const agents = [
    {
      name: "Researcher-1",
      status: "available" as const,
      capabilities: ["defi-analysis", "web-search"],
      reputation: 85,
    },
    {
      name: "Planner-Alpha",
      status: "working" as const,
      capabilities: ["goal-decomposition", "synthesis"],
      reputation: 92,
      currentJob: "Analyze liquid staking risks",
    },
  ]

  return NextResponse.json(agents)
}
