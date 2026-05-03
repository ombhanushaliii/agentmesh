import { AgentMesh } from "@agentmesh/sdk";
import type { AgentEvent, JobPost } from "@agentmesh/types";
import { GoogleGenAI } from "@google/genai";
import { RESEARCHER_SYSTEM_PROMPT } from "./prompts";

async function callLLM(ai: GoogleGenAI, system: string, user: string): Promise<string> {
  const res = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ role: "user", parts: [{ text: `${system}\n\n${user}` }] }],
  });
  return res.text ?? "";
}

export class ResearcherAgent {
  private mesh: AgentMesh;
  private agentName: string;
  private ai: GoogleGenAI;
  private activeJobs = new Set<string>();
  private jobDescriptions = new Map<string, string>();

  constructor(config: {
    privateKey: string;
    axlBridgeUrl?: string;
    agentName?: string;
    inferenceApiKey: string;
  }) {
    this.agentName = config.agentName ?? "researcher-01";
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
    await this.mesh.register(["web-research", "summarization"], 8_000_000_000_000_000n);

    this.mesh.onJobAvailable(async (job: JobPost) => {
      if (this.activeJobs.has(job.id)) return;
      this.activeJobs.add(job.id);
      this.jobDescriptions.set(job.id, job.description);
      await this.mesh.bid(job.id, 8_000_000_000_000_000n, job.planner);
    });

    this.mesh.onBidAccepted(async (accept, plannerEndpoint) => {
      if (!this.activeJobs.has(accept.jobId)) return;
      const description = this.jobDescriptions.get(accept.jobId) ?? accept.jobId;
      await this.handleJob(accept.jobId, description, plannerEndpoint);
    });
  }

  private async handleJob(
    jobId: string,
    description: string,
    plannerEndpoint: string
  ): Promise<void> {
    try {
      const content = await callLLM(this.ai, RESEARCHER_SYSTEM_PROMPT, description);
      await this.mesh.submitResult(jobId, content, plannerEndpoint);
    } catch (e) {
      console.error(`[${this.agentName}] job ${jobId} failed:`, e);
    } finally {
      this.activeJobs.delete(jobId);
      this.jobDescriptions.delete(jobId);
    }
  }

  async stop(): Promise<void> {
    this.mesh.disconnect();
  }
}
