import { NextResponse } from "next/server"
import { ethers } from "ethers"
import { CapabilityRegistryABI, addresses } from "@agentmesh/contracts"

const CAPABILITIES = ["planning", "synthesis", "web-research", "summarization"]

export async function GET() {
  try {
    const rpcUrl = process.env.RPC_URL ?? "https://evmrpc-testnet.0g.ai"
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const registry = new ethers.Contract(
      addresses.CapabilityRegistry,
      CapabilityRegistryABI,
      provider
    )

    const seen = new Map<string, any>()
    for (const cap of CAPABILITIES) {
      const raw: any[] = await registry.lookup(cap)
      raw.forEach((a) => seen.set(a.agentAddress, a))
    }

    const profiles = Array.from(seen.values()).map((a) => ({
      name: a.name as string,
      status: (a.available ? "available" : "offline") as string,
      capabilities: Array.from(a.capabilities) as string[],
      reputation: Number(a.reputation.score),
    }))

    return NextResponse.json(profiles)
  } catch (e) {
    console.error("Failed to fetch agents:", e)
    return NextResponse.json([])
  }
}
