import { AgentMesh } from "@agentmesh/sdk";
import type { AgentEvent, JobResult } from "@agentmesh/types";
import { GoogleGenAI } from "@google/genai";
import { DECOMPOSITION_PROMPT, SYNTHESIS_PROMPT } from "./prompts";

type DecompositionTask = { description: string; capability: string };

async function callLLM(ai: GoogleGenAI, system: string, user: string): Promise<string> {
  const res = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ role: "user", parts: [{ text: `${system}\n\n${user}` }] }],
  });
  return res.text ?? "";
}

export class PlannerAgent {
  private mesh: AgentMesh;
  private agentName: string;
  private ai: GoogleGenAI;
  private resultCache = new Map<string, string>();

  constructor(config: {
    privateKey: string;
    axlBridgeUrl?: string;
    agentName?: string;
    inferenceApiKey: string;
  }) {
    this.agentName = config.agentName ?? "planner-01";
    this.ai = new GoogleGenAI({ apiKey: config.inferenceApiKey });
    this.mesh = new AgentMesh({
      privateKey: config.privateKey,
      axlBridgeUrl: config.axlBridgeUrl,
      agentName: this.agentName,
    });
  }

  onAgentEvent(handler: (e: AgentEvent) => void | Promise<void>): void {
    this.mesh.onAgentEvent(handler);
  }

  async start(): Promise<void> {
    await this.mesh.connect();
    await this.mesh.register(["planning", "synthesis"], 0n);

    // Auto-accept first bid per job (production would score by reputation/price)
    const acceptedJobs = new Set<string>();
    this.mesh.onBid(async (bid) => {
      if (acceptedJobs.has(bid.jobId)) return;
      acceptedJobs.add(bid.jobId);
      await this.mesh.acceptBid(bid.jobId, bid.specialist, bid.bidPrice);
    });

    // Cache result content as it arrives via AXL before chain confirmation
    this.mesh.onResult((result) => {
      if (result.content) this.resultCache.set(result.jobId, result.content);
    });
  }

  async executeGoal(goal: string): Promise<string> {
    const subJobBudget = 1_000_000_000_000_000n; // 0.001 ETH per sub-job

    // 1. Decompose goal into sub-tasks
    const decomposition = await this.runDecomposition(goal);
    const tasks: DecompositionTask[] = decomposition.tasks;

    // 2. Post parent job + sub-jobs on-chain
    // Parent job budget must be non-zero; each sub-job has its own separate escrow
    const now = Math.floor(Date.now() / 1000);
    const parentJobId = await this.mesh.postJob(goal, "planning", subJobBudget, now + 360);

    const childIds = await this.mesh.decompose(
      parentJobId,
      tasks.map((t) => ({
        description: t.description,
        capability: t.capability,
        budget: subJobBudget,
        deadline: now + 180,
      }))
    );

    // 3. Wait for all sub-jobs to settle (KeeperHub auto-settles after dispute window)
    const settled = await this.mesh.awaitAllSubJobs(parentJobId, childIds);

    // 4. Synthesize — content arrives via AXL before chain settlement
    const results: JobResult[] = settled.map((r) => ({
      ...r,
      content: this.resultCache.get(r.jobId) ?? "",
    }));
    this.resultCache.clear();

    return this.runSynthesis(goal, results);
  }

  private async runDecomposition(
    goal: string
  ): Promise<{ tasks: DecompositionTask[] }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await callLLM(this.ai, DECOMPOSITION_PROMPT, goal);
      const clean = raw.replace(/```json\n?|\n?```/g, "").trim();
      try {
        return JSON.parse(clean) as { tasks: DecompositionTask[] };
      } catch {
        if (attempt === 1) throw new Error(`Decomposition JSON parse failed: ${clean}`);
      }
    }
    throw new Error("Unreachable");
  }

  private async runSynthesis(goal: string, results: JobResult[]): Promise<string> {
    const combined = results
      .map((r, i) => `### Research ${i + 1}\n\n${r.content || "(no content)"}`)
      .join("\n\n---\n\n");
    return callLLM(this.ai, SYNTHESIS_PROMPT, `Goal: ${goal}\n\n${combined}`);
  }

  async stop(): Promise<void> {
    this.mesh.disconnect();
  }
}
