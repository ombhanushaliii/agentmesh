# AgentMesh — Hackathon Feedback

## What worked well

**AXL messaging**: The two-node single-machine setup (planner on 9102, researcher on 9112, peered via TCP 9101) worked cleanly. The AXLClient's single-poll multiplexing pattern — one shared poll in `connect()` fanning out to all `_msgHandlers` — eliminated double-registration bugs that plagued earlier approaches.

**Contract architecture**: `releasePayout` being callable by anyone after the dispute window was the right design. It decoupled settlement from a privileged key and made the KeeperHub integration composable — any automated caller (KeeperHub, a cron job, a watcher script) can trigger it without special permissions.

**Bun workspace**: Having all packages in a single workspace with `workspace:*` dependencies meant zero version coordination overhead. Bun's fast cold starts made the `bun run scripts/run-researcher.ts` iteration loop fast.

**Gemini 2.0 Flash**: Reliable, fast, and the OpenAI-compatible interface made it easy to swap in. The decomposition + synthesis prompts worked well enough on the first draft.

**shadcn/ui + Tailwind v4**: The black-and-white constraint actually made the UI better — fewer decisions, cleaner result.

## What was hard

**Settlement wiring**: The `KeeperHubSettlement` class needed an `executeContractCall` function injected from outside. This created a subtle problem: MCP tools (like the KeeperHub MCP) are only callable from a Claude Code session, not from running Node.js code. We solved it by providing a direct ethers implementation as the executor (since `releasePayout` is permissionless), which is architecturally equivalent for the demo.

**monitor.ts bugs**: The `JobDelivered` event listener had the wrong parameter count (an extra `specialist` arg that doesn't exist in the Solidity event) and compared `job.status === 2` (Number) instead of `2n` (BigInt) — ethers v6 returns enum values as BigInt. Both bugs silently swallowed events, making settlement never fire. Fixed by aligning with the actual ABI.

**0G Compute unavailable on testnet**: The original plan used 0G Compute for inference. Mainnet funds required. Switched to Gemini 2.0 Flash, which required a full inference abstraction swap mid-build.

**Next.js not reading root .env**: Next.js requires its own `.env.local` inside `apps/dashboard/`. The root `.env` is only read by Bun. This caused silent failures where agent config was `undefined` in the dashboard API routes.

**awaitAllSubJobs blocking on SETTLED**: The planner couldn't proceed to synthesis until all sub-jobs reached `SETTLED` on-chain. This meant the settlement monitor had to be running alongside the planner — not obvious from reading the code alone. The fix was starting `KeeperHubSettlement` as a singleton in the same process as the planner (in `/api/run`).

## What we'd improve with more time

- **KeeperHub workflow registration**: Instead of a local monitor calling `releasePayout`, register a KeeperHub workflow that watches for `JobDelivered` events and triggers settlement automatically — true external automation.
- **Multiple researchers**: The demo uses one researcher. The protocol supports any number. Adding a second researcher with different capabilities would demonstrate the bid-scoring and reputation system more dramatically.
- **Dispute demo**: The 30-second window is short for a demo. A pause button to freeze after delivery, then trigger a dispute, would make the dispute resolution path visible.
- **0G Storage reads in UI**: The result card shows the synthesized text but doesn't link to the 0G Storage file URL where the raw research is stored. Adding that link would close the loop visually.
- **Reputation visualization**: Scores update after every settlement but the UI only shows the current value. A small sparkline per agent would make the reputation mechanic legible over multiple runs.
