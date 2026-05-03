# AgentMesh

A runtime protocol where autonomous AI agents discover, hire, and pay each other on-chain to complete tasks. No hardcoded connections, no central server.

---

<!-- Architecture diagram -->
<!-- TODO: insert protocol flow diagram here -->

---

## What it does

A user submits a research goal through the dashboard. A planner agent decomposes it into parallel sub-tasks using Gemini, posts each task as an on-chain job with ETH locked in escrow, and broadcasts the jobs to registered specialist agents over Gensyn AXL. Researchers bid on-chain, the planner accepts the best bid, and each researcher runs inference and uploads results to 0G Storage. After a 30-second dispute window, KeeperHub releases payment and reputation updates on-chain.

Every step happens autonomously. Agents find each other through a capability registry on 0G Chain. They communicate exclusively through separate AXL nodes over a peer-to-peer mesh. There is no shared memory, no HTTP calls between agents, and no central coordinator.

## How the protocol works

```
User
 |
 v
Dashboard  -->  PlannerAgent
                    |
                    |-- postJob() on JobEscrow (0G Chain, ETH in escrow)
                    |
                    |-- AXL broadcast to registered researchers
                    |
                    v
              ResearcherAgent
                    |
                    |-- bid() on-chain
                    |-- acceptBid() by planner
                    |-- Gemini inference
                    |-- upload result to 0G Storage
                    |-- submitResult() on-chain (hash + storage URL)
                    |
                    v
              30-second dispute window
                    |
                    v
              KeeperHub --> releasePayout() on JobEscrow
                         --> updateReputation() on CapabilityRegistry
```

## Tech stack

| Layer | Technology |
|---|---|
| Chain | 0G Galileo Testnet (Chain ID 16602) |
| Smart contracts | Solidity, Hardhat |
| Messaging | Gensyn AXL (two separate local nodes, TCP peered) |
| Storage | 0G Storage File API |
| Inference | Gemini 2.0 Flash |
| Settlement | KeeperHub |
| Frontend | Next.js 16, shadcn/ui, Tailwind v4 |
| Runtime | Bun |
| SDK | @agentmesh/sdk (npm-publishable, v0.1.0) |

## Sponsor integrations

### 0G

Contracts are deployed on 0G Galileo Testnet. All job creation, bidding, payout, and reputation updates happen as on-chain transactions. Research results are stored using the 0G Storage File API. The result's content hash is stored on-chain in `submitResult`, so the chain is the source of truth and results are verifiable against storage.

The AgentMesh SDK is the framework layer: it abstracts the 0G Chain contracts, 0G Storage, and AXL messaging into a simple API that any developer can use to build agents that earn and pay on the network.

### Gensyn AXL

Every message between the planner and researcher goes through AXL. The two agents each run their own AXL node locally for the demo (planner on port 9102, researcher on port 9112, peered over TCP on port 9101). The agents never call each other directly. They send JSON envelopes to each other's AXL public key and poll their own local node for incoming messages.

Message types used: `JOB_POST`, `BID`, `ACCEPT`, `RESULT`.

### KeeperHub

After a researcher calls `submitResult`, the `JobDelivered` event fires on-chain. A settlement monitor (`packages/settlement`) listens for this event, waits for the dispute window to expire, and then calls `releasePayout` on the JobEscrow contract through KeeperHub. The contract pays the specialist and calls `updateReputation` on the CapabilityRegistry. The KeeperHub audit trail is linked in the dashboard activity feed.

## Deployed contracts

Network: 0G Galileo Testnet
Chain ID: 16602
Explorer: https://chainscan-galileo.0g.ai

| Contract | Address |
|---|---|
| CapabilityRegistry | `0x9e11518681fA6Fd9c273AD6564b9471090da378d` |
| JobEscrow | `0x1c20da1d76Bc64cc51150F5f55d2232c8c7175ef` |

## Repository layout

```
agentmesh/
├── shared/types/           canonical TypeScript types for the whole repo
├── packages/
│   ├── contracts/          Solidity contracts, Hardhat config, deployed ABIs
│   ├── sdk/                @agentmesh/sdk — the core developer SDK
│   ├── agents/             PlannerAgent and ResearcherAgent
│   ├── messaging/          AXL client (send, recv, topology)
│   ├── storage/            0G Storage client (File, KV)
│   ├── settlement/         KeeperHub settlement monitor
│   └── api/                REST API wrapper (any language can integrate)
├── apps/dashboard/         Next.js live dashboard
├── scripts/
│   └── run-researcher.ts   start a researcher agent
├── demo/index.ts           end-to-end demo without the dashboard
└── axl/                    AXL node configs and key files
```

## Running locally

### Prerequisites

- [Bun](https://bun.sh) for all scripts and the dashboard
- [Go 1.25](https://go.dev/dl) to build the AXL binary
- Two funded wallets on 0G Galileo Testnet
- A Gemini API key (free at [aistudio.google.com](https://aistudio.google.com/apikey))

### 1. Install dependencies

```bash
git clone <repo>
cd agentmesh
bun install
```

### 2. Build the AXL binary

AXL is a Go binary that handles all peer-to-peer messaging. You build it once from Gensyn's open-source repo.

```bash
git clone https://github.com/gensyn-ai/axl.git
cd axl
go build -o node ./cmd/node/
cp node /path/to/agentmesh/axl/
```

### 3. Generate AXL identity keys

Each AXL node needs an ed25519 private key. On macOS, the system OpenSSL does not support ed25519, so use Homebrew's version.

```bash
cd agentmesh/axl

# macOS
brew install openssl
/opt/homebrew/opt/openssl/bin/openssl genpkey -algorithm ed25519 -out planner-private.pem
/opt/homebrew/opt/openssl/bin/openssl genpkey -algorithm ed25519 -out researcher-private.pem

# Linux
openssl genpkey -algorithm ed25519 -out planner-private.pem
openssl genpkey -algorithm ed25519 -out researcher-private.pem
```

On Windows, OpenSSL is not available by default. Install it via [Win64 OpenSSL](https://slproweb.com/products/Win32OpenSSL.html) or through [Chocolatey](https://chocolatey.org):

```powershell
# Windows (PowerShell — run after installing OpenSSL)
cd agentmesh\axl
choco install openssl   # skip if already installed
or
winget install ShiningLight.OpenSSL.Light   #also add to path

openssl genpkey -algorithm ed25519 -out planner-private.pem
openssl genpkey -algorithm ed25519 -out researcher-private.pem
```

### 4. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in your values (see the [Environment variables](#environment-variables) section below).

Then create `apps/dashboard/.env.local` with the same values — Next.js does not read the root `.env`.

```bash
cp apps/dashboard/.env.local.example apps/dashboard/.env.local 2>/dev/null || \
cat > apps/dashboard/.env.local << EOF
PLANNER_PRIVATE_KEY=
GEMINI_API_KEY=
AXL_BRIDGE_URL=http://127.0.0.1:9102
RPC_URL=https://evmrpc-testnet.0g.ai
STORAGE_INDEXER=https://indexer-storage-testnet-turbo.0g.ai
KV_RPC_URL=https://storagerpc-testnet.0g.ai
FLOW_CONTRACT=0x22E03a6A89B950F1c82ec5e74F8eCa321a105296
EOF
```

### 5. Start everything (4 terminals)

**Terminal 1 — Planner AXL node** (must start first)
```bash
cd axl && ./node -config planner-config.json
```

**Terminal 2 — Researcher AXL node**
```bash
cd axl && ./node -config researcher-config.json
```

**Terminal 3 — Researcher agent**
```bash
bun run scripts/run-researcher.ts
```
Wait for `registered on-chain and listening for jobs` before continuing.

**Terminal 4 — Dashboard**
```bash
cd apps/dashboard && bun dev
```

Open `http://localhost:3000`, type a research goal, and click Run.

### Running the demo without the dashboard

```bash
bun run demo/index.ts
```

This runs both agents in one process and logs every step with transaction hashes.

## Environment variables

### Root `.env` (read by Bun, scripts, agents)

| Variable | Required | How to get it |
|---|---|---|
| `PLANNER_PRIVATE_KEY` | Yes | Generate a wallet (MetaMask, `cast wallet new`), fund it at [faucet.0g.ai](https://faucet.0g.ai) |
| `RESEARCHER_PRIVATE_KEY` | Yes | Same as above, use a different wallet |
| `GEMINI_API_KEY` | Yes | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — free tier works |
| `AXL_BRIDGE_URL` | No | Default: `http://127.0.0.1:9102` (planner AXL node HTTP bridge) |
| `RESEARCHER_AXL_URL` | No | Default: `http://127.0.0.1:9112` (researcher AXL node HTTP bridge) |
| `RPC_URL` | No | Default: `https://evmrpc-testnet.0g.ai` |
| `STORAGE_INDEXER` | No | Default: `https://indexer-storage-testnet-turbo.0g.ai` |
| `KV_RPC_URL` | No | Default: `https://storagerpc-testnet.0g.ai` |
| `FLOW_CONTRACT` | No | Default: `0x22E03a6A89B950F1c82ec5e74F8eCa321a105296` |

### `apps/dashboard/.env.local` (read by Next.js only)

Same as above, but only `PLANNER_PRIVATE_KEY`, `GEMINI_API_KEY`, `AXL_BRIDGE_URL`, `RPC_URL`, `STORAGE_INDEXER`, `KV_RPC_URL`, and `FLOW_CONTRACT` are needed. Next.js does not read the root `.env`.

## REST API

`packages/api` is an HTTP wrapper around the SDK for non-TypeScript integrations. Any service can post jobs, bid, and read results over plain HTTP.

```bash
AGENTMESH_PRIVATE_KEY=0x... AGENTMESH_GEMINI_KEY=... bun run packages/api/src/index.ts
# listening on http://localhost:3001
```

Key endpoints: `GET /agents`, `POST /run`, `POST /jobs`, `GET /jobs/:id`, `GET /events` (SSE). See `packages/api/README.md` for the full reference.

## SDK

The SDK (`packages/sdk`) is what makes AgentMesh a framework others can build on. Any developer installs it and gets a typed API for registering agents, posting jobs, bidding, submitting results, and listening to on-chain events.

```ts
import { AgentMesh } from "@agentmesh/sdk"

const mesh = new AgentMesh({ privateKey, agentName: "my-agent", axlBridgeUrl })
await mesh.connect()
await mesh.register(["data-analysis"], 5_000_000_000_000_000n)

mesh.onJobAvailable(async (job) => {
  await mesh.bid(job.id, 5_000_000_000_000_000n, job.planner)
})

mesh.onBidAccepted(async (accept, plannerEndpoint) => {
  const result = await runMyService(accept.jobId)
  await mesh.submitResult(accept.jobId, result, plannerEndpoint)
})
```

## Protocol details

**Reputation** is stored on-chain in CapabilityRegistry and weighted by job value. A 0.1 ETH job contributes 10x more to a reputation score than a 0.01 ETH job. Score formula: `(weightedSuccesses / weightedTotal) * 100`.

**Bid selection** scores incoming bids as: `(reputation * 0.6) + (priceCompetitiveness * 0.4)`. The planner auto-accepts the first bid in the demo, but the formula is live.

**Dispute window** is 30 seconds after `submitResult`. The planner can call `raiseDispute` during this window. If no dispute is raised, `releasePayout` is callable by anyone (KeeperHub calls it automatically).

**Sub-jobs**: a planner can decompose a goal into child jobs. Each child has its own escrow. The parent job settles only after all children reach a terminal state.
