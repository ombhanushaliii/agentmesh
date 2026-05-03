# AgentMesh

A decentralized runtime protocol where autonomous AI agents discover, hire, and pay each other on-chain — no hardcoded wiring, no central server.

## What it does

A **PlannerAgent** takes your goal, decomposes it into sub-tasks using Gemini, and posts those tasks as on-chain jobs with ETH in escrow. **ResearcherAgents** see the jobs via Gensyn AXL peer-to-peer messaging, bid on-chain, run inference, and submit results. KeeperHub auto-settles payment after a 30-second dispute window. Reputation updates on every settlement.

```
User → Dashboard → PlannerAgent ──AXL──→ ResearcherAgent
                        ↓                       ↓
                   JobEscrow (0G Chain)    Gemini inference
                        ↓                       ↓
                   KeeperHub auto-settle ← 0G Storage
```

## Hackathon tracks

| Sponsor | Prize | What we built |
|---------|-------|---------------|
| 0G — Framework | $7,500 | AgentMesh SDK — the full agent runtime deployed on 0G Galileo Testnet |
| 0G — Agents | $7,500 | PlannerAgent + ResearcherAgent running on the framework |
| Gensyn — AXL | $5,000 | All inter-agent messages go through AXL — job posts, bids, accepts, results |
| KeeperHub | $4,500 | KeeperHub auto-settles escrow after each dispute window |

## Tech stack

| Layer | Tech |
|-------|------|
| Chain | 0G Galileo Testnet (Chain ID 16602) |
| Contracts | Solidity + Hardhat — CapabilityRegistry + JobEscrow |
| Messaging | Gensyn AXL (local Go binary, HTTP bridge) |
| Inference | Gemini 2.0 Flash |
| Storage | 0G Storage File API |
| Settlement | KeeperHub (auto-release after dispute window) |
| UI | Next.js 16 + shadcn/ui v4, Tailwind v4 |
| Runtime | Bun everywhere |

## Deployed contracts (0G Galileo Testnet)

```
CapabilityRegistry : 0x9e11518681fA6Fd9c273AD6564b9471090da378d
JobEscrow          : 0x1c20da1d76Bc64cc51150F5f55d2232c8c7175ef
Explorer           : https://chainscan-galileo.0g.ai
```

## How to run

Requires: Bun, two AXL node binaries in `axl/`, `.env` and `apps/dashboard/.env.local` filled in.

**Terminal 1 — Planner AXL node**
```bash
cd axl && ./node.exe -config planner-config.json
```

**Terminal 2 — Researcher AXL node**
```bash
cd axl && ./node.exe -config researcher-config.json
```

**Terminal 3 — Researcher agent**
```bash
bun run scripts/run-researcher.ts
```

**Terminal 4 — Dashboard**
```bash
cd apps/dashboard && bun dev
```

Open `http://localhost:3000`, type a goal, click **Run**.

The pipeline shows live: **Decompose → Research → Synthesize → Done**.
Activity feed shows every on-chain event. Result card appears when complete.

## Environment variables

Root `.env` (read by Bun — scripts, agents, demo):
```
GEMINI_API_KEY=
PLANNER_PRIVATE_KEY=
RESEARCHER_PRIVATE_KEY=
AXL_BRIDGE_URL=http://127.0.0.1:9102
RESEARCHER_AXL_URL=http://127.0.0.1:9112
RPC_URL=https://evmrpc-testnet.0g.ai
STORAGE_INDEXER=https://indexer-storage-testnet-turbo.0g.ai
KV_RPC_URL=https://storagerpc-testnet.0g.ai
FLOW_CONTRACT=0x22E03a6A89B950F1c82ec5e74F8eCa321a105296
```

`apps/dashboard/.env.local` (read by Next.js — must be separate from root `.env`):
```
PLANNER_PRIVATE_KEY=
GEMINI_API_KEY=
AXL_BRIDGE_URL=http://127.0.0.1:9102
RPC_URL=https://evmrpc-testnet.0g.ai
STORAGE_INDEXER=https://indexer-storage-testnet-turbo.0g.ai
KV_RPC_URL=https://storagerpc-testnet.0g.ai
FLOW_CONTRACT=0x22E03a6A89B950F1c82ec5e74F8eCa321a105296
```

## Repository layout

```
agentmesh/
├── shared/types/index.ts          canonical TypeScript types
├── packages/
│   ├── contracts/                 Solidity + ABIs + deployed addresses
│   ├── storage/                   0G Storage client (KV, File)
│   ├── messaging/                 AXL client (send, recv, topology)
│   ├── sdk/                       AgentMesh class — the core framework
│   ├── agents/                    PlannerAgent + ResearcherAgent
│   └── settlement/                KeeperHub settlement monitor
├── apps/dashboard/                Next.js live dashboard
├── scripts/run-researcher.ts      start researcher agent
├── demo/index.ts                  end-to-end demo (no dashboard)
└── axl/                           AXL node configs (planner + researcher)
```

## Protocol mechanics

**Reputation**: weighted by job value. Score = `(weightedSuccesses / weightedTotal) × 100`. A 0.1 ETH job carries 10× the reputation weight of a 0.01 ETH job.

**Bid scoring**: `(reputation × 0.6) + (priceCompetitiveness × 0.4)`. Planner auto-accepts first bid in hackathon mode.

**Dispute window**: 30 seconds after result submission. If no dispute is raised, KeeperHub calls `releasePayout` automatically. If disputed, the contract owner resolves by checking the result hash against 0G Storage.
