import { NextResponse } from "next/server"
import { ethers } from "ethers"
import { JobEscrowABI, addresses } from "@agentmesh/contracts"

export async function POST(req: Request) {
  try {
    const { jobId } = await req.json()
    if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 })

    const privateKey = process.env.PLANNER_PRIVATE_KEY
    if (!privateKey) return NextResponse.json({ error: "PLANNER_PRIVATE_KEY not set" }, { status: 500 })

    const rpcUrl = process.env.RPC_URL ?? "https://evmrpc-testnet.0g.ai"
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const wallet = new ethers.Wallet(privateKey, provider)
    const escrow = new ethers.Contract(addresses.JobEscrow, JobEscrowABI, wallet)

    const tx = await (escrow as any).raiseDispute(jobId)
    const receipt = await tx.wait()

    return NextResponse.json({ ok: true, txHash: receipt.hash })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.toLowerCase().includes("dispute") && msg.toLowerCase().includes("window")) {
      return NextResponse.json({ error: "dispute window has closed" }, { status: 400 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
