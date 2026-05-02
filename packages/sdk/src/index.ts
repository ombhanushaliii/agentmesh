import { ethers } from "ethers";
import { createStorageClient, type StorageClient } from "@agentmesh/storage";
import {
  AXLClient,
  makeJobPost,
  makeBid,
  makeAccept,
  makeResult,
} from "@agentmesh/messaging";
import { CapabilityRegistryABI, JobEscrowABI, addresses } from "@agentmesh/contracts";
import type {
  AgentProfile,
  JobPost,
  Bid,
  JobResult,
  MessageEnvelope,
  JobPostMessage,
  BidMessage,
  AcceptMessage,
  ResultMessage,
  AgentEvent,
  JobStatus,
  DisputeStatus,
} from "@agentmesh/types";

export type {
  AgentProfile,
  JobPost,
  Bid,
  JobResult,
  MessageEnvelope,
  AgentEvent,
  AcceptMessage,
};

export interface AgentMeshConfig {
  privateKey: string;
  axlPort: number;
  agentName: string;
  rpcUrl?: string;
}

const JOB_STATUS: JobStatus[] = [
  "OPEN", "ASSIGNED", "DELIVERED", "SETTLED", "CANCELLED", "DISPUTED", "FAILED",
];

const DISPUTE_STATUS: DisputeStatus[] = [
  "NONE", "RAISED", "RESOLVED_SPECIALIST_FAULT", "RESOLVED_PLANNER_FAULT",
];

function sid(label: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

export class AgentMesh {
  private config: AgentMeshConfig;
  private wallet!: ethers.Wallet;
  private provider!: ethers.JsonRpcProvider;
  private registry!: ethers.Contract;
  private escrow!: ethers.Contract;
  private axl!: AXLClient;
  private storage!: StorageClient;

  private _endpoint = "";
  private _address = "";
  private _eventCounter = 0;
  private _eventHandlers: Array<(e: AgentEvent) => void | Promise<void>> = [];
  private _msgHandlers: Array<(msg: MessageEnvelope) => void | Promise<void>> = [];

  constructor(config: AgentMeshConfig) {
    this.config = config;
  }

  // ── Lifecycle ──────────────────────────────────────────────

  async connect(): Promise<void> {
    const rpcUrl =
      this.config.rpcUrl ?? process.env.RPC_URL ?? "https://evmrpc-testnet.0g.ai";

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(this.config.privateKey, this.provider);
    this._address = await this.wallet.getAddress();

    const registryAddr = addresses.CapabilityRegistry;
    const escrowAddr = addresses.JobEscrow;

    if (!registryAddr || registryAddr === "0x" || !escrowAddr || escrowAddr === "0x") {
      throw new Error(
        "contracts not deployed — set CAPABILITY_REGISTRY_ADDRESS / JOB_ESCROW_ADDRESS"
      );
    }

    this.registry = new ethers.Contract(registryAddr, CapabilityRegistryABI, this.wallet);
    this.escrow = new ethers.Contract(escrowAddr, JobEscrowABI, this.wallet);

    this.axl = new AXLClient(`http://127.0.0.1:${this.config.axlPort}`);
    this._endpoint = await this.axl.publicKey();

    this.storage = createStorageClient({ privateKey: this.config.privateKey, rpcUrl });

    // Single poll — all on* handlers go through here to avoid subscribe's guard
    this.axl.subscribe(async (msg) => {
      await Promise.all(this._msgHandlers.map((h) => h(msg).catch(() => {})));
    });
  }

  disconnect(): void {
    this.axl.unsubscribe();
  }

  getEndpoint(): string {
    return this._endpoint;
  }

  // ── Registry ──────────────────────────────────────────────

  async register(capabilities: string[], pricePerJob: bigint): Promise<void> {
    const tx = await this.registry.register(
      this.config.agentName,
      capabilities,
      pricePerJob,
      this._endpoint
    );
    const receipt = await tx.wait();
    await this._emit({
      type: "AGENT_REGISTERED",
      agentName: this.config.agentName,
      txHash: receipt.hash,
      explorerUrl: `https://chainscan-galileo.0g.ai/tx/${receipt.hash}`,
    });
  }

  async findAgents(capability: string): Promise<AgentProfile[]> {
    const raw = await this.registry.lookup(capability);
    return (raw as any[]).map(this._mapProfile);
  }

  async getProfile(): Promise<AgentProfile> {
    const raw = await this.registry.getProfile(this._address);
    return this._mapProfile(raw);
  }

  // ── Planner: posting jobs ─────────────────────────────────

  async postJob(
    description: string,
    capability: string,
    maxBudget: bigint,
    deadline: number,
    parentJobId?: string
  ): Promise<string> {
    const tx = await (this.escrow as any).postJob(
      description,
      capability,
      deadline,
      parentJobId ?? ethers.ZeroHash,
      { value: maxBudget }
    );
    const receipt = await tx.wait();

    const parsed = (receipt.logs as any[])
      .map((l) => { try { return this.escrow.interface.parseLog(l); } catch { return null; } })
      .find((e) => e?.name === "JobPosted");

    const jobId = parsed?.args?.jobId as string | undefined;
    if (!jobId) throw new Error("postJob: JobPosted event not found in receipt");

    const payload: JobPostMessage = {
      jobId,
      description,
      requiredCapability: capability,
      maxBudget: maxBudget.toString(),
      deadline,
      plannerEndpoint: this._endpoint,
    };

    const agents = await this.findAgents(capability);
    await Promise.all(
      agents.map((a) => this.axl.send(makeJobPost(this._endpoint, a.endpoint, payload)))
    );

    await this._emit({
      type: "JOB_POSTED",
      agentName: this.config.agentName,
      jobId,
      txHash: receipt.hash,
      explorerUrl: `https://chainscan-galileo.0g.ai/tx/${receipt.hash}`,
    });

    return jobId;
  }

  onJobAvailable(
    handler: (job: JobPost, plannerEndpoint: string) => void | Promise<void>
  ): void {
    this._msgHandlers.push(async (msg) => {
      if (msg.type !== "JOB_POST") return;
      const p = msg.payload as JobPostMessage;
      const job: JobPost = {
        id: p.jobId,
        planner: p.plannerEndpoint, // AXL endpoint — not ETH address
        description: p.description,
        requiredCapability: p.requiredCapability,
        maxBudget: BigInt(p.maxBudget),
        deadline: p.deadline,
        status: "OPEN",
        disputeStatus: "NONE",
        createdAt: msg.timestamp,
      };
      await handler(job, p.plannerEndpoint);
    });
  }

  // ── Planner: bid management ───────────────────────────────

  onBid(
    handler: (bid: Bid, specialistEndpoint: string) => void | Promise<void>
  ): void {
    this._msgHandlers.push(async (msg) => {
      if (msg.type !== "BID") return;
      const p = msg.payload as BidMessage;
      const bid: Bid = {
        jobId: p.jobId,
        specialist: p.specialistAddress,
        bidPrice: BigInt(p.bidPrice),
        timestamp: msg.timestamp,
      };
      await this._emit({
        type: "BID_RECEIVED",
        agentName: this.config.agentName,
        jobId: p.jobId,
        detail: `bid ${p.bidPrice} from ${p.specialistAddress}`,
      });
      await handler(bid, p.specialistEndpoint);
    });
  }

  async acceptBid(
    jobId: string,
    specialistAddress: string,
    agreedPrice: bigint
  ): Promise<void> {
    const tx = await (this.escrow as any).acceptBid(jobId, specialistAddress, agreedPrice);
    const receipt = await tx.wait();

    const profile = await this.registry.getProfile(specialistAddress);
    const specialistEndpoint: string = profile.endpoint;

    await this.axl.send(
      makeAccept(this._endpoint, specialistEndpoint, {
        jobId,
        specialistAddress,
        agreedPrice: agreedPrice.toString(),
      })
    );

    await this._emit({
      type: "BID_ACCEPTED",
      agentName: this.config.agentName,
      jobId,
      txHash: receipt.hash,
      explorerUrl: `https://chainscan-galileo.0g.ai/tx/${receipt.hash}`,
    });
  }

  onResult(handler: (result: JobResult) => void | Promise<void>): void {
    this._msgHandlers.push(async (msg) => {
      if (msg.type !== "RESULT") return;
      const p = msg.payload as ResultMessage;
      const result: JobResult = {
        jobId: p.jobId,
        resultHash: p.resultHash,
        resultUrl: p.resultUrl,
        specialist: msg.from,
        deliveredAt: msg.timestamp,
      };
      await this._emit({
        type: "RESULT_SUBMITTED",
        agentName: this.config.agentName,
        jobId: p.jobId,
      });
      await handler(result);
    });
  }

  // ── Specialist: bidding and delivering ────────────────────

  async bid(jobId: string, bidPrice: bigint, plannerEndpoint: string): Promise<void> {
    const tx = await (this.escrow as any).bid(jobId, bidPrice);
    await tx.wait();

    await this.axl.send(
      makeBid(this._endpoint, plannerEndpoint, {
        jobId,
        specialistAddress: this._address,
        specialistEndpoint: this._endpoint,
        bidPrice: bidPrice.toString(),
      })
    );
  }

  // plannerEndpoint is msg.from of the ACCEPT envelope
  onBidAccepted(
    handler: (accept: AcceptMessage, plannerEndpoint: string) => void | Promise<void>
  ): void {
    this._msgHandlers.push(async (msg) => {
      if (msg.type !== "ACCEPT") return;
      await handler(msg.payload as AcceptMessage, msg.from);
    });
  }

  async submitResult(
    jobId: string,
    content: string,
    plannerEndpoint: string
  ): Promise<JobResult> {
    const bytes = Buffer.from(content);

    await this._emit({ type: "INFERENCE_DONE", agentName: this.config.agentName, jobId });

    const rootHash = await this.storage.fileUpload(bytes);
    const resultHash = ethers.keccak256(bytes);

    const tx = await (this.escrow as any).submitResult(jobId, resultHash, rootHash);
    const receipt = await tx.wait();

    await this.axl.send(
      makeResult(this._endpoint, plannerEndpoint, { jobId, resultHash, resultUrl: rootHash })
    );

    await this._emit({
      type: "RESULT_SUBMITTED",
      agentName: this.config.agentName,
      jobId,
      txHash: receipt.hash,
      explorerUrl: `https://chainscan-galileo.0g.ai/tx/${receipt.hash}`,
    });

    return {
      jobId,
      resultHash,
      resultUrl: rootHash,
      content,
      specialist: this._address,
      deliveredAt: Date.now(),
    };
  }

  // ── Planner: decomposition ────────────────────────────────

  async decompose(
    parentJobId: string,
    subTasks: Array<{
      description: string;
      capability: string;
      budget: bigint;
      deadline: number;
    }>
  ): Promise<string[]> {
    return Promise.all(
      subTasks.map((t) =>
        this.postJob(t.description, t.capability, t.budget, t.deadline, parentJobId)
      )
    );
  }

  async awaitAllSubJobs(parentJobId: string, childJobIds: string[]): Promise<JobResult[]> {
    const TERMINAL = new Set([3n, 4n, 6n]); // SETTLED, CANCELLED, FAILED

    const jobs = await Promise.all(childJobIds.map((id) => (this.escrow as any).getJob(id)));
    const maxDeadline = Math.max(...jobs.map((j: any) => Number(j.deadline)));
    const timeoutAt = (maxDeadline + 60) * 1000;

    while (true) {
      if (Date.now() > timeoutAt) {
        throw new Error(`awaitAllSubJobs: timed out waiting for parent ${parentJobId}`);
      }

      const statuses = await Promise.all(
        childJobIds.map((id) => (this.escrow as any).getJob(id))
      );

      if (statuses.every((j: any) => TERMINAL.has(j.status))) {
        const failed = statuses.filter((j: any) => j.status === 6n);
        if (failed.length > 0) {
          throw new Error(`awaitAllSubJobs: ${failed.length} sub-job(s) failed`);
        }
        return statuses
          .filter((j: any) => j.status === 3n)
          .map((j: any) => ({
            jobId: j.id as string,
            resultHash: j.resultHash as string,
            resultUrl: j.resultUrl as string,
            specialist: j.specialist as string,
            deliveredAt: Number(j.settledAt) * 1000,
          }));
      }

      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // ── Events ────────────────────────────────────────────────

  onAgentEvent(handler: (e: AgentEvent) => void | Promise<void>): void {
    this._eventHandlers.push(handler);
  }

  async getJobHistory(start = 0, limit = 50): Promise<AgentEvent[]> {
    return this.storage.logReadJSON<AgentEvent>(sid(`events:${this._address}`), start, limit);
  }

  // ── Internal ──────────────────────────────────────────────

  private async _emit(partial: Omit<AgentEvent, "id" | "timestamp">): Promise<void> {
    const event: AgentEvent = {
      id: `${this._address}-${this._eventCounter++}`,
      timestamp: Date.now(),
      ...partial,
    };
    // Fire-and-forget to storage — non-fatal if storage isn't reachable
    this.storage
      ?.logAppendJSON(sid(`events:${this._address}`), event)
      .catch(() => {});
    await Promise.all(this._eventHandlers.map((h) => Promise.resolve(h(event)).catch(() => {})));
  }

  private _mapProfile(raw: any): AgentProfile {
    return {
      address: raw.agentAddress,
      name: raw.name,
      capabilities: Array.from(raw.capabilities) as string[],
      pricePerJob: BigInt(raw.pricePerJob),
      endpoint: raw.endpoint,
      available: raw.available,
      registeredAt: Number(raw.registeredAt),
      reputation: {
        score: Number(raw.reputation.score),
        totalJobs: Number(raw.reputation.totalJobs),
        successfulJobs: Number(raw.reputation.successfulJobs),
        weightedSuccesses: BigInt(raw.reputation.weightedSuccesses),
        weightedTotal: BigInt(raw.reputation.weightedTotal),
      },
    };
  }
}
