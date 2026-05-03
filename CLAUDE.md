# AgentMesh

A decentralized runtime protocol where autonomous AI agents discover, hire, and
pay each other at runtime — no hardcoded wiring, no central server, no developer
manually connecting them.

---

## The problem being solved

Every multi-agent system today is statically wired. Agent A calls Agent B because
a developer wrote that connection. The network is only as dynamic as the person
who configured it. There is no way for agents to find capabilities they need at
runtime, negotiate a price, hold payment in escrow, and settle automatically.

AgentMesh introduces three on-chain primitives that make agent collaboration
self-organizing:

- **Capability Registry** — agents register what they can do, what they charge,
  and their current reputation. Other agents query this to find who to hire.
- **Job Protocol** — agents post tasks with a budget. Capable agents bid.
  The posting agent accepts the best bid based on price and reputation.
- **Escrow + Settlement** — payment is locked on-chain when a job is posted.
  It releases only after verifiable delivery, enforced by KeeperHub.

---

## Protocol mechanics (answer these if a judge asks)

### How is reputation calculated?

Every agent starts at zero. Reputation is stored on-chain in CapabilityRegistry
and updated by JobEscrow after each job settles.

Formula:reputationScore = (weightedSuccesses / weightedTotal) * 100

Each job contributes weight proportional to its escrow value. A 0.1 ETH job
carries 10x the reputation weight of a 0.01 ETH job. This prevents reputation
farming through tiny low-risk jobs.

A "success" is: job reaches SETTLED status without a dispute.
A "failure" is: job cancelled by specialist (missed deadline), or dispute
resolved against the specialist.

Reputation is capped at 100 and floored at 0. It never resets — the full
history is queryable from the Log store.

### How is pay decided?

The posting agent sets a `maxBudget` when creating a job. Specialists bid any
amount up to that budget. Their bid is their actual asking price for this job —
they can bid lower than their registered `pricePerJob` if they want the work.

The posting agent ranks incoming bids by a score:bidScore = (reputation * 0.6) + ((maxBudget - bidPrice) / maxBudget * 100 * 0.4)

Reputation accounts for 60% of the score, price competitiveness 40%. The
planner can override and manually select any bidder via `acceptBid`. The escrow
locks `bidPrice` — not `maxBudget`. The unused remainder returns to the planner.

### What if one planner employs multiple specialists?

A single job can have sub-jobs. When `postJob` is called with a `parentJobId`,
it creates a child job. The parent job stays in ASSIGNED state until all child
jobs reach SETTLED or CANCELLED. Escrow is split: each child job has its own
escrow drawn from the parent's locked amount.

This means a planner can decompose a goal into parallel tasks, each assigned to
a different specialist, each with independent payment.

### Who gets blamed when the goal isn't met?

Blame and reputation impact depend on where in the chain the failure occurred.
The on-chain state machine enforces this:

**Specialist fault** (reputation penalty to specialist):
- Job reached ASSIGNED but specialist never called `submitResult` before deadline
- Dispute raised by planner and resolved as SPECIALIST_FAULT

**Planner fault** (reputation penalty to planner):
- Planner posted a job, accepted a bid, specialist submitted a result, but planner
  disputes and loses (result is deemed valid)
- Planner posted sub-jobs with a bad decomposition — all specialists delivered
  correctly but the parent goal wasn't met. Since each specialist's result was
  accepted, the fault is attributed to the planner's decomposition logic.

**No fault** (neutral, no reputation change):
- Job cancelled before any bid was accepted (planner's prerogative)
- Job expired with zero bids (no specialist was available)

**Multi-agent failure example:**
PlannerAgent decomposes "analyze DeFi risks" into three sub-jobs. Sub-job A
(ResearcherAgent 1) delivers and is accepted. Sub-job B (ResearcherAgent 2)
misses the deadline — SPECIALIST_FAULT for Agent 2. Sub-job C delivers but
planner raises a dispute and wins — SPECIALIST_FAULT for Agent 3. The parent
job is partially complete. Planner receives refunds for the failed sub-jobs and
their reputation takes a small hit for poor deadline management (failing to
cancel early). Agent 2 and Agent 3 each take full reputation penalties.

### Dispute resolution

After `submitResult`, there is a 30-second dispute window (configurable, set
short for hackathon demo). During this window the planner can call `raiseDispute`.
If no dispute is raised, KeeperHub auto-settles. If a dispute is raised:

For the hackathon, disputes are auto-resolved by a simple rule: if the result
hash stored on-chain matches the content at the 0G Storage URL, the specialist
wins. If the URL returns nothing or the hash mismatches, the planner wins.

Production would use a proper arbitration layer — the architecture supports
plugging one in at the `resolveDispute` function.

---

## Hackathon tracks

| Sponsor | Prize | What we built |
|---------|-------|---------------|
| 0G — Framework | $7,500 | AgentMesh SDK is the framework. Deployed on 0G Chain. |
| 0G — Agents | $7,500 | PlannerAgent + ResearcherAgent run on the framework. |
| Gensyn — AXL | $5,000 | AXL is the only inter-agent messaging layer. |
| KeeperHub | $4,500 | KeeperHub MCP executes all on-chain settlements. |

---

## Tech stack

| Layer | Technology | Source |
|-------|-----------|--------|
| Runtime | Bun | everywhere |
| Language | TypeScript strict | everywhere |
| Contracts | Solidity + Hardhat | packages/contracts |
| Chain | 0G Chain (EVM) | docs/0g-context.md |
| Storage | 0G Storage KV + Log + File | docs/0g-context.md |
| Inference | 0G Compute — qwen3-6-plus | docs/0g-context.md |
| Messaging | Gensyn AXL | Gensyn AXL MCP |
| Settlement | KeeperHub | KeeperHub MCP |
| UI | shadcn/ui | shadcn MCP + example/ui/ |

---

## Repository layoutagentmesh/
├── CLAUDE.md
├── README.md
├── FEEDBACK.md
├── package.json               root bun workspace
├── bun.lockb
├── .env.example
├── docs/
│   ├── 0g-context.md          DO NOT EDIT — 0G API reference
│   └── architecture.md        mermaid diagram
├── example/
│   └── ui/                    DO NOT EDIT — shadcn design reference
├── shared/
│   └── types/
│       └── index.ts           canonical types, everyone imports from here
├── packages/
│   ├── contracts/             Solidity + deploy scripts + ABIs
│   ├── storage/               0G Storage client wrapper
│   ├── messaging/             Gensyn AXL client wrapper
│   ├── sdk/                   AgentMesh developer SDK
│   └── agents/                PlannerAgent + ResearcherAgent
├── apps/
│   └── dashboard/             Next.js + shadcn UI
└── demo/
└── index.ts               end-to-end demo runner

---

## Shared types (canonical, defined in shared/types/index.ts)AgentProfile     JobPost          JobStatus        Bid
JobResult        SubJobMap        DisputeStatus    ReputationRecord
MessageEnvelope  MessageType      JobPostMessage   BidMessage
AcceptMessage    ResultMessage    EscrowState      AgentEvent

**Never define these elsewhere.** Import only from `@agentmesh/types`.
If a new type is needed, add it to shared/types/index.ts and tell the other
person immediately.

---

## Contract addressesCapabilityRegistry : 0x9e11518681fA6Fd9c273AD6564b9471090da378d
JobEscrow          : 0x1c20da1d76Bc64cc51150F5f55d2232c8c7175ef
Network            : 0G Chain (Galileo Testnet)
Chain ID           : 16602

---

## Non-negotiable technical decisions

- **Bun** for all scripts, tests, builds. Not Node.
- **AXL only** for inter-agent messages. No HTTP, WebSocket, or shared memory
  between agents. If two agents communicate, it goes through AXL.
- **KeeperHub MCP** for all on-chain payout execution. Not raw ethers calls.
- **0G Compute** for all inference inside agents. Not OpenAI, not Anthropic.
- **0G Storage KV** for real-time agent state. **Log** for history. **File** for
  result content.
- **shadcn base theme only** in UI. Black and white. No custom color palette.
  Match example/ui/ exactly for spacing, border radius, font, component structure.
  Use shadcn MCP to pull components. No unnecessary icons or decorative elements.

---

## UI design rules

Before writing any UI code, study example/ui/ in full.

- Colors: black and white only. shadcn CSS variables. No hardcoded hex.
- Font: match example/ui exactly — size, weight, family, line height.
- Border radius: match example/ui exactly.
- Dark mode and light mode: both must work out of the box.
- Only build components that serve a function. No decorative icons. No gradients.
- Ask: would a non-technical person understand this screen immediately?
- Ask: does this look AI-generated or thoughtfully designed? Fix it if the former.

---

## Working agreements

- Read this file at the start of every session.
- Update the progress section below after every commit.
- Never silently change an interface another package depends on.
- If something in a sponsor's MCP or docs conflicts with the plan, stop and
  tell the human before proceeding.
- Raise blockers immediately. Don't paper over them with silent mocks.
- Commit messages: one line, lowercase, present tense. No fluff.

---

## SDK design deltas (packages/sdk)

- **`onBid(handler)`** — added (not in original spec). Planners need to receive
  BID messages; without it there is no way to call `acceptBid`. Handler receives
  `(bid: Bid, specialistEndpoint: string)`.

- **`job.planner` in `onJobAvailable`** — set to `plannerEndpoint` from the AXL
  `JobPostMessage`, which is the planner's AXL public key, not their ETH address.
  Pragmatic for hackathon: the ETH address is not needed for messaging.

- **`onBidAccepted` signature** — `handler(accept: AcceptMessage, plannerEndpoint: string)`.
  The second arg is `msg.from` from the ACCEPT envelope; specialists need it to
  call `submitResult(jobId, content, plannerEndpoint)`.

- **AXL single-poll multiplexing** — `AXLClient.subscribe` guards against double
  registration (`if (this._poll) return`). The SDK sets up one shared poll in
  `connect()` and fans out to all `_msgHandlers`. Never call
  `axl.subscribe()` directly from `on*` methods.

- **`connect()` throws on empty addresses** — if `addresses.CapabilityRegistry`
  or `addresses.JobEscrow` is an empty string or `"0x"`, connect throws
  `"contracts not deployed"`. Deploy contracts first and fill
  `packages/contracts/deployments/addresses.json`.

---

## Progress

### Infrastructure (packages/contracts, storage, messaging, sdk, shared/types)
- [x] Repo initialized — bun workspace, tsconfig, .env.example
- [x] shared/types/index.ts committed
- [x] CapabilityRegistry.sol — deployed, address recorded above
- [x] JobEscrow.sol — deployed, address recorded above
- [x] packages/storage — 0G KV + Log + File working
- [x] packages/messaging — AXL client working (10 unit tests passing; two-node test requires live AXL binary)
- [x] packages/sdk — AgentMesh class written; end-to-end requires deployed contracts
- [x] packages/sdk/examples/minimal-agent.ts written
- [x] docs/architecture.md written

### Application (agents, settlement, dashboard, demo)
- [x] ResearcherAgent — registers, receives jobs, runs Gemini 2.0 Flash inference
- [x] PlannerAgent — decomposes goals, posts jobs, synthesizes results via Gemini 2.0 Flash
- [x] packages/settlement — dispute window monitor fixed (event params + BigInt); ethers executor wired
- [x] apps/dashboard — Next.js UI renders, pipeline visualization, agent cards, activity feed, result card
- [x] demo/index.ts — full loop written, AXL ports corrected (9102/9112)
- [x] Contracts deployed to 0G testnet — addresses.json filled
- [x] dashboard wired to real agents — settlement singleton starts alongside planner in /api/run
- [x] README.md complete
- [x] FEEDBACK.md written

---

## What judges see in the demo

1. Dashboard opens at localhost:3000
2. ResearcherAgent is live — shown as registered with capabilities and reputation
3. User types a goal and clicks Run
4. Dashboard updates live: job posted → bid received → accepted →
   inference running → result delivered → payout settled
5. Each step links to 0G explorer and KeeperHub audit trail
6. Final synthesized answer appears in a result card
7. Reputation scores update on both agents after settlement