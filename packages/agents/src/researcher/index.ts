import { AgentMesh } from "@agentmesh/sdk";
import { JobPost, AgentEvent } from "@agentmesh/types";
import { RESEARCHER_SYSTEM_PROMPT } from "./prompts";
import { GoogleGenAI } from "@google/genai";

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
    async decompose(_p: any, _t: any) { return [] }
    async awaitAllSubJobs(_p: any, _c: any) { return [] }
    onAgentEvent(_h: any) {}
    async getJobHistory() { return [] }
    async getProfile() { return null }
  }
}

export class ResearcherAgent {
  private mesh: AgentMesh;
  private activeJobId: string | null = null;
  private agentName: string;
  private ai: GoogleGenAI;

  constructor(config: { privateKey: string; axlPort: number; agentName?: string; computeApiKey?: string }) {
    this.agentName = config.agentName || 'researcher-01';
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
    await this.mesh.register(["web-research", "summarization"], 8000000000000000n);

    this.mesh.onJobAvailable(async (job: JobPost) => {
      await this.handleJob(job);
    });

    this.emitEvent("AGENT_REGISTERED");
  }

  private async handleJob(job: JobPost): Promise<void> {
    if (this.activeJobId) return;

    this.emitEvent("BID_RECEIVED", job.id);
    await this.mesh.bid(job.id, 8000000000000000n, job.planner);

    this.mesh.onBidAccepted(async (accept, plannerEndpoint) => {
      if (accept.jobId !== job.id) return;

      this.activeJobId = job.id;
      this.emitEvent("INFERENCE_STARTED", job.id);

      try {
        const result = await this.runInference(job.description);
        this.emitEvent("INFERENCE_DONE", job.id);

        await this.mesh.submitResult(job.id, result, plannerEndpoint);
        this.emitEvent("RESULT_SUBMITTED", job.id);
      } catch (e) {
        console.error(`[${this.agentName}] Inference failed:`, e);
      } finally {
        this.activeJobId = null;
      }
    });
  }

  private async runInference(prompt: string): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        { role: "system", parts: [{ text: RESEARCHER_SYSTEM_PROMPT }] },
        { role: "user", parts: [{ text: prompt }] },
      ],
    });
    return response.text || "No result generated";
  }

  private emitEvent(type: AgentEvent["type"], jobId?: string, detail?: string) {
    console.log(`[EVENT] ${type} | Agent: ${this.agentName}${jobId ? ` | Job: ${jobId}` : ""}${detail ? ` | ${detail}` : ""}`);
  }

  async stop(): Promise<void> {
    await this.mesh.disconnect();
  }
}
