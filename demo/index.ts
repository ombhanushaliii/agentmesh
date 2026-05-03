import { PlannerAgent } from "@agentmesh/agents";
import { ResearcherAgent } from "@agentmesh/agents";
import { KeeperHubSettlement } from "@agentmesh/settlement";
import { ethers } from "ethers";
import { JobEscrowABI, addresses } from "@agentmesh/contracts";

const log = (step: number, msg: string) =>
  console.log(`[${new Date().toISOString()}] [Step ${step}] ${msg}`);

async function runDemo() {
  const plannerKey = process.env.PLANNER_PRIVATE_KEY;
  const researcherKey = process.env.RESEARCHER_PRIVATE_KEY;
  const inferenceApiKey = process.env.GEMINI_API_KEY;

  if (!plannerKey || !researcherKey || !inferenceApiKey) {
    console.error("Set PLANNER_PRIVATE_KEY, RESEARCHER_PRIVATE_KEY, and GEMINI_API_KEY in .env");
    process.exit(1);
  }

  // Researcher connects to its own AXL node (port 9112)
  log(1, "Starting ResearcherAgent...");
  const researcher = new ResearcherAgent({
    privateKey: researcherKey,
    axlBridgeUrl: process.env.RESEARCHER_AXL_URL ?? "http://127.0.0.1:9112",
    agentName: "researcher-01",
    inferenceApiKey,
  });
  researcher.onAgentEvent((e) =>
    log(1, `[${e.agentName}] ${e.type}${e.jobId ? ` job=${e.jobId.slice(0, 8)}` : ""}`)
  );
  await researcher.start();
  log(1, "Researcher registered on-chain");

  // Planner connects to its own AXL node (port 9102)
  log(2, "Starting PlannerAgent...");
  const planner = new PlannerAgent({
    privateKey: plannerKey,
    axlBridgeUrl: process.env.AXL_BRIDGE_URL ?? "http://127.0.0.1:9102",
    agentName: "planner-01",
    inferenceApiKey,
  });
  planner.onAgentEvent((e) =>
    log(2, `[${e.agentName}] ${e.type}${e.jobId ? ` job=${e.jobId.slice(0, 8)}` : ""}${e.txHash ? ` tx=${e.txHash.slice(0, 10)}` : ""}`)
  );
  await planner.start();
  log(2, "Planner registered on-chain");

  // Start settlement monitor so JobDelivered events trigger releasePayout
  const rpcUrl = process.env.RPC_URL ?? "https://evmrpc-testnet.0g.ai";
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const settlerWallet = new ethers.Wallet(plannerKey, provider);
  const escrowContract = new ethers.Contract(addresses.JobEscrow, JobEscrowABI, settlerWallet);
  const settlement = new KeeperHubSettlement({
    rpcUrl,
    jobEscrowAddress: addresses.JobEscrow,
    executeContractCall: async ({ abiFunction, functionArgs }) => {
      const args = JSON.parse(functionArgs) as unknown[];
      const tx = await (escrowContract as any)[abiFunction](...args);
      const receipt = await tx.wait();
      log(3, `Settlement: ${abiFunction}(${String(args[0]).slice(0, 10)}) tx=${receipt.hash.slice(0, 10)}`);
      return { transactionHash: receipt.hash as string, taskId: receipt.hash as string };
    },
  });
  settlement.start().catch((e) => console.error("[settlement] monitor error:", e));

  const goal = "Research the top 3 risks of liquid staking in 2025";
  log(3, `Executing goal: "${goal}"`);

  const result = await planner.executeGoal(goal);

  log(4, "Final synthesized answer:");
  console.log("\n" + "─".repeat(60));
  console.log(result);
  console.log("─".repeat(60) + "\n");

  log(5, "Shutting down...");
  await settlement.stop();
  await researcher.stop();
  await planner.stop();
}

runDemo().catch((e) => {
  console.error("Demo failed:", e);
  process.exit(1);
});
