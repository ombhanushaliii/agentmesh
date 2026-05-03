/**
 * AgentMesh REST API
 *
 * Wraps the AgentMesh SDK as an HTTP server so any language can integrate
 * with the AgentMesh network — no TypeScript required.
 *
 * Environment variables:
 *   AGENTMESH_PRIVATE_KEY   required — wallet private key (0x...)
 *   AGENTMESH_AGENT_NAME    optional — name shown on-chain (default: "api-agent")
 *   AGENTMESH_AXL_URL       optional — AXL node HTTP bridge (default: http://127.0.0.1:9102)
 *   AGENTMESH_RPC_URL       optional — 0G Chain RPC (default: https://evmrpc-testnet.0g.ai)
 *   AGENTMESH_GEMINI_KEY    optional — enables POST /run (full goal orchestration)
 *   PORT                    optional — HTTP port (default: 3001)
 */

import { AgentMesh } from "@agentmesh/sdk"
import { ethers } from "ethers"
import { JobEscrowABI, addresses } from "@agentmesh/contracts"
import type { AgentEvent } from "@agentmesh/types"

// ── Config ─────────────────────────────────────────────────────────────────

const PORT          = Number(process.env.PORT ?? 3001)
const privateKey    = process.env.AGENTMESH_PRIVATE_KEY ?? ""
const agentName     = process.env.AGENTMESH_AGENT_NAME ?? "api-agent"
const axlBridgeUrl  = process.env.AGENTMESH_AXL_URL ?? "http://127.0.0.1:9102"
const rpcUrl        = process.env.AGENTMESH_RPC_URL ?? "https://evmrpc-testnet.0g.ai"
const geminiKey     = process.env.AGENTMESH_GEMINI_KEY ?? ""

if (!privateKey) {
  console.error("[api] AGENTMESH_PRIVATE_KEY is required")
  process.exit(1)
}

// ── Helpers ────────────────────────────────────────────────────────────────

const enc = new TextEncoder()

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

function jsonResponse(data: unknown, status = 200) {
  const body = JSON.stringify(data, (_, v) =>
    typeof v === "bigint" ? v.toString() : v
  )
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  })
}

function errResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status)
}

const JOB_STATUS = [
  "OPEN", "ASSIGNED", "DELIVERED", "SETTLED", "CANCELLED", "DISPUTED", "FAILED",
] as const

// ── SSE broadcast ──────────────────────────────────────────────────────────

const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>()

function broadcast(event: AgentEvent) {
  const chunk = enc.encode(`data: ${JSON.stringify(event)}\n\n`)
  for (const ctrl of [...sseClients]) {
    try { ctrl.enqueue(chunk) } catch { sseClients.delete(ctrl) }
  }
}

// ── Initialize SDK ─────────────────────────────────────────────────────────

const mesh = new AgentMesh({ privateKey, agentName, axlBridgeUrl, rpcUrl })
mesh.onAgentEvent(broadcast)

console.log(`[api] connecting to AXL at ${axlBridgeUrl} ...`)
await mesh.connect()
console.log(`[api] connected — endpoint: ${mesh.getEndpoint()}`)

// Chain read-only client (for GET /jobs/:id)
const provider = new ethers.JsonRpcProvider(rpcUrl)
const escrowRead = new ethers.Contract(addresses.JobEscrow, JobEscrowABI, provider)

// Optional planner (requires Gemini key)
let planner: { executeGoal: (g: string) => Promise<string> } | null = null

if (geminiKey) {
  const { PlannerAgent } = await import("@agentmesh/agents")
  const p = new PlannerAgent({ privateKey, axlBridgeUrl, agentName, inferenceApiKey: geminiKey })
  p.onAgentEvent(broadcast)
  await p.start()
  planner = p
  console.log("[api] planner mode active — POST /run is available")
}

// ── Route handler ──────────────────────────────────────────────────────────

Bun.serve({
  port: PORT,

  async fetch(req) {
    const url  = new URL(req.url)
    const segs = url.pathname.replace(/^\/+|\/+$/g, "").split("/")
    const [s0, s1, s2] = segs

    // Preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: CORS })
    }

    try {

      // ── GET /health ──────────────────────────────────────────────────────
      if (req.method === "GET" && s0 === "health") {
        return jsonResponse({
          ok: true,
          agentName,
          endpoint: mesh.getEndpoint(),
          plannerEnabled: !!planner,
          network: "0g-galileo-testnet",
          contracts: {
            CapabilityRegistry: addresses.CapabilityRegistry,
            JobEscrow: addresses.JobEscrow,
          },
        })
      }

      // ── GET /me ──────────────────────────────────────────────────────────
      if (req.method === "GET" && s0 === "me") {
        const profile = await mesh.getProfile()
        return jsonResponse(profile)
      }

      // ── POST /register ───────────────────────────────────────────────────
      // body: { capabilities: string[], pricePerJob?: string }
      if (req.method === "POST" && s0 === "register") {
        const body = await req.json() as { capabilities?: string[]; pricePerJob?: string }
        if (!body.capabilities?.length) return errResponse("capabilities[] required")
        await mesh.register(body.capabilities, BigInt(body.pricePerJob ?? "0"))
        return jsonResponse({ ok: true, capabilities: body.capabilities })
      }

      // ── GET /agents?capability=X ─────────────────────────────────────────
      if (req.method === "GET" && s0 === "agents" && !s1) {
        const cap = url.searchParams.get("capability") ?? "web-research"
        const agents = await mesh.findAgents(cap)
        return jsonResponse(agents)
      }

      // ── POST /run ────────────────────────────────────────────────────────
      // body: { goal: string }
      // Requires AGENTMESH_GEMINI_KEY — orchestrates full agent pipeline
      if (req.method === "POST" && s0 === "run") {
        if (!planner) {
          return errResponse(
            "Planner not available. Set AGENTMESH_GEMINI_KEY to enable POST /run.",
            503
          )
        }
        const body = await req.json() as { goal?: string }
        if (!body.goal?.trim()) return errResponse("goal is required")
        const result = await planner.executeGoal(body.goal)
        return new Response(result, {
          headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS },
        })
      }

      // ── POST /jobs ───────────────────────────────────────────────────────
      // body: { description, capability, budget, deadline? }
      // Posts a single job on-chain and broadcasts via AXL to matching agents
      if (req.method === "POST" && s0 === "jobs" && !s1) {
        const body = await req.json() as {
          description?: string
          capability?: string
          budget?: string
          deadline?: number
        }
        if (!body.description) return errResponse("description required")
        if (!body.capability)  return errResponse("capability required")
        if (!body.budget)      return errResponse("budget required (wei as string)")
        const deadline = body.deadline ?? Math.floor(Date.now() / 1000) + 300
        const jobId = await mesh.postJob(
          body.description,
          body.capability,
          BigInt(body.budget),
          deadline
        )
        return jsonResponse({ jobId })
      }

      // ── GET /jobs/:id ────────────────────────────────────────────────────
      // Reads job state directly from the chain
      if (req.method === "GET" && s0 === "jobs" && s1 && !s2) {
        const job = await escrowRead.getJob(s1)
        return jsonResponse({
          id:          s1,
          status:      JOB_STATUS[Number(job.status)] ?? "UNKNOWN",
          description: job.description as string,
          capability:  job.requiredCapability as string,
          planner:     job.planner as string,
          specialist:  job.specialist as string,
          maxBudget:   job.maxBudget.toString(),
          agreedPrice: job.agreedPrice.toString(),
          resultHash:  job.resultHash as string,
          resultUrl:   job.resultUrl as string,
          deadline:    Number(job.deadline),
          createdAt:   Number(job.createdAt),
          settledAt:   Number(job.settledAt),
          explorerUrl: `https://chainscan-galileo.0g.ai/tx/${s1}`,
        })
      }

      // ── POST /jobs/:id/bid ───────────────────────────────────────────────
      // body: { price: string, plannerEndpoint: string }
      if (req.method === "POST" && s0 === "jobs" && s1 && s2 === "bid") {
        const body = await req.json() as { price?: string; plannerEndpoint?: string }
        if (!body.price)           return errResponse("price required (wei as string)")
        if (!body.plannerEndpoint) return errResponse("plannerEndpoint required")
        await mesh.bid(s1, BigInt(body.price), body.plannerEndpoint)
        return jsonResponse({ ok: true, jobId: s1 })
      }

      // ── POST /jobs/:id/accept ────────────────────────────────────────────
      // body: { specialist: string, price: string }
      if (req.method === "POST" && s0 === "jobs" && s1 && s2 === "accept") {
        const body = await req.json() as { specialist?: string; price?: string }
        if (!body.specialist) return errResponse("specialist address required")
        if (!body.price)      return errResponse("price required (wei as string)")
        await mesh.acceptBid(s1, body.specialist, BigInt(body.price))
        return jsonResponse({ ok: true, jobId: s1 })
      }

      // ── POST /jobs/:id/result ────────────────────────────────────────────
      // body: { content: string, plannerEndpoint: string }
      if (req.method === "POST" && s0 === "jobs" && s1 && s2 === "result") {
        const body = await req.json() as { content?: string; plannerEndpoint?: string }
        if (!body.content)         return errResponse("content required")
        if (!body.plannerEndpoint) return errResponse("plannerEndpoint required")
        const result = await mesh.submitResult(s1, body.content, body.plannerEndpoint)
        return jsonResponse(result)
      }

      // ── GET /events ──────────────────────────────────────────────────────
      // Server-sent events stream — emits AgentEvent objects
      if (req.method === "GET" && s0 === "events") {
        let ctrl: ReadableStreamDefaultController<Uint8Array>
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            ctrl = c
            sseClients.add(c)
            c.enqueue(enc.encode(": connected\n\n"))
          },
          cancel() { sseClients.delete(ctrl) },
        })
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            ...CORS,
          },
        })
      }

      return errResponse("not found", 404)

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error("[api] unhandled error:", msg)
      return errResponse(msg, 500)
    }
  },
})

console.log(`[api] listening on http://localhost:${PORT}`)
console.log(`[api] endpoints: GET /health  GET /agents  POST /run  POST /jobs  GET /events`)
