/**
 * Minimal specialist agent — registers, waits for jobs, bids, delivers.
 * Run: bun packages/sdk/examples/minimal-agent.ts
 */
import { AgentMesh } from "@agentmesh/sdk";

const agent = new AgentMesh({
  privateKey: process.env.RESEARCHER_PRIVATE_KEY!,
  axlPort: 9002,
  agentName: "ResearcherAgent",
});

await agent.connect();
await agent.register(["research"], 500_000_000_000_000n); // 0.0005 ETH per job

console.log("ResearcherAgent online —", agent.getEndpoint());

agent.onJobAvailable(async (job, plannerEndpoint) => {
  console.log("job available:", job.id, job.description);
  await agent.bid(job.id, BigInt(job.maxBudget) / 2n, plannerEndpoint);
});

agent.onBidAccepted(async (accept, plannerEndpoint) => {
  console.log("bid accepted for job:", accept.jobId);
  const content = `Research result for ${accept.jobId} — placeholder`;
  await agent.submitResult(accept.jobId, content, plannerEndpoint);
});

agent.onAgentEvent((e) => console.log("[event]", e.type, e.jobId ?? ""));
