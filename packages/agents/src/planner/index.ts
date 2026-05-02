import { AgentMesh } from "@agentmesh/sdk";
import { AgentEvent, JobResult } from "@agentmesh/types";
import { DECOMPOSITION_PROMPT, SYNTHESIS_PROMPT } from "./prompts";
import { GoogleGenAI } from "@google/genai";

type DecompositionTask = {
  description: string;
  capability: string;
};

type DecompositionResponse = {
  tasks: DecompositionTask[];
};

// Mock for SDK if not available
const SDK_AVAILABLE = false;
if (!SDK_AVAILABLE) {
  class AgentMesh {
    constructor(_c: any) {}
    async connect() {}
    async disconnect() {}
    getEndpoint() { return 'mock-axl' }
    async register(_p: any) {}
    async findAgents(_c: any) { return [] }
    async postJob(_p: any) { return 'job-' + Date.now() }
    onJobAvailable(_h: any) {}
    async acceptBid(_j: any, _b: any) {}
    onResult(_h: any) {}
    async bid(_j: any, _p: any, _e: any) {}
    onBidAccepted(_h: any) {}
    async submitResult(_j: any, _c: any) {
      return { jobId:'mock', resultHash:'0x', resultUrl:'mock', specialist:'0x0', deliveredAt: Date.now() }
    }
    async decompose(_p: any, _t: any) { return ['child-1', 'child-2'] }
    async awaitAllSubJobs(_p: any, _c: any) {
      return [{ jobId: 'child-1', content: 'Result 1' }, { jobId: 'child-2', content: 'Result 2' }];
    }
    onAgentEvent(_h: any) {}
    async getJobHistory() { return [] }
    async getProfile() { return null }
  }
}

export class PlannerAgent {
  private mesh: AgentMesh;
  private agentName: string;
  private ai: GoogleGenAI;

  constructor(config: { privateKey: string; axlPort: number; agentName?: string; computeApiKey?: string }) {
    this.agentName = config.agentName || 'planner-01';
    this.mesh = new AgentMesh({
      privateKey: config.privateKey,
      axlPort: config.axlPort,
      agentName: this.agentName,
    });
    this.ai = new GoogleGenAI({
      apiKey: config.computeApiKey || process.env.GEMINI_API_KEY,
    });
  }

  async start(): Promise<void> {
    await this.mesh.connect();
    await this.mesh.register(["planning", "synthesis"], 0n);
    this.emitEvent("AGENT_REGISTERED");
  }

  async executeGoal(goal: string): Promise<string> {
    // 1. Decompose
    const decomposition = await this.runDecomposition(goal);
    const tasks: DecompositionTask[] = decomposition.tasks;

    // 2. Post Jobs
    const parentDeadline = Math.floor(Date.now() / 1000) + 360;
    const parentJobId = await this.mesh.postJob(goal, "planning", 0n, parentDeadline);

    const childIds = await this.mesh.decompose(parentJobId, tasks.map((t) => ({
      description: t.description,
      capability: t.capability,
      budget: 1000000000000000n,
      deadline: Math.floor(Date.now() / 1000) + 120,
    })));

    childIds.forEach(id => this.emitEvent("JOB_POSTED", id));

    // 3. Await results
    let results: JobResult[];
    try {
      results = await this.mesh.awaitAllSubJobs(parentJobId, childIds);
    } catch (e) {
      throw new Error(`Sub-jobs failed or timed out: ${e}`);
    }

    // 4. Synthesize
    const finalAnswer = await this.runSynthesis(goal, results);
    this.emitEvent("INFERENCE_DONE", parentJobId);

    return finalAnswer;
  }

  private async runDecomposition(goal: string): Promise<DecompositionResponse> {
    let attempt = 0;
    while (attempt < 2) {
      const response = await this.ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          { role: "system", parts: [{ text: DECOMPOSITION_PROMPT }] },
          { role: "user", parts: [{ text: goal }] },
        ],
      });
      const content = response.text || "";
      try {
        return JSON.parse(content) as DecompositionResponse;
      } catch (e) {
        attempt++;
        if (attempt === 2) throw new Error(`Invalid JSON from LLM after 2 attempts: ${content}`);
      }
    }
    throw new Error("Failed to decompose goal");
  }

  private async runSynthesis(goal: string, results: JobResult[]): Promise<string> {
    const resultsText = results.map((r) => `Job ${r.jobId}: ${r.content ?? ""}`).join("\n\n");
    const response = await this.ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        { role: "system", parts: [{ text: SYNTHESIS_PROMPT }] },
        { role: "user", parts: [{ text: `Goal: ${goal}\n\nResults:\n${resultsText}` }] },
      ],
    });
    return response.text || "Failed to synthesize results";
  }

  private emitEvent(type: AgentEvent["type"], jobId?: string) {
    console.log(`[EVENT] ${type} | Agent: ${this.agentName}${jobId ? ` | Job: ${jobId}` : ""}`);
  }

  async stop(): Promise<void> {
    await this.mesh.disconnect();
  }
}
