import { ResearcherAgent } from "@agentmesh/agents";

const privateKey = process.env.RESEARCHER_PRIVATE_KEY;
const inferenceApiKey = process.env.GEMINI_API_KEY;
const axlBridgeUrl = process.env.RESEARCHER_AXL_URL ?? "http://127.0.0.1:9112";
const agentName = process.env.RESEARCHER_NAME ?? "researcher-01";

if (!privateKey) { console.error("RESEARCHER_PRIVATE_KEY not set"); process.exit(1); }
if (!inferenceApiKey) { console.error("GEMINI_API_KEY not set"); process.exit(1); }

const agent = new ResearcherAgent({
  privateKey,
  axlBridgeUrl,
  agentName,
  inferenceApiKey,
});

agent.onAgentEvent((e) => {
  const parts = [e.type, e.jobId?.slice(0, 8), e.detail].filter(Boolean);
  console.log(`[${new Date().toISOString()}] [${e.agentName}] ${parts.join(" — ")}`);
  if (e.txHash) console.log(`  tx: https://chainscan-galileo.0g.ai/tx/${e.txHash}`);
});

async function main() {
  console.log(`[researcher] connecting to AXL at ${axlBridgeUrl} ...`);
  await agent.start();
  console.log("[researcher] registered on-chain and listening for jobs");
  console.log("[researcher] press Ctrl+C to stop");

  process.on("SIGINT", async () => {
    console.log("\n[researcher] shutting down...");
    await agent.stop();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error("[researcher] fatal:", e);
  process.exit(1);
});
