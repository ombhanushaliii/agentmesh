export interface ReputationRecord {
  score: number;            // 0–100
  totalJobs: number;
  successfulJobs: number;
  weightedSuccesses: bigint; // sum of escrow values of successful jobs
  weightedTotal: bigint;     // sum of all completed job values
  // score = (weightedSuccesses / weightedTotal) * 100
  // weighted by job value so a 0.1 ETH job counts 10x a 0.01 ETH job
}

export interface AgentProfile {
  address: string;
  name: string;
  capabilities: string[];
  pricePerJob: bigint;
  endpoint: string;         // AXL node address
  available: boolean;
  registeredAt: number;
  reputation: ReputationRecord;
}

export type JobStatus =
  | "OPEN"
  | "ASSIGNED"
  | "DELIVERED"
  | "SETTLED"
  | "CANCELLED"
  | "DISPUTED"
  | "FAILED";

export type DisputeStatus =
  | "NONE"
  | "RAISED"
  | "RESOLVED_SPECIALIST_FAULT"
  | "RESOLVED_PLANNER_FAULT";

export interface JobPost {
  id: string;
  parentJobId?: string;     // set when this is a sub-job
  planner: string;
  description: string;
  requiredCapability: string;
  maxBudget: bigint;
  agreedPrice?: bigint;     // set after bid accepted
  deadline: number;
  status: JobStatus;
  disputeStatus: DisputeStatus;
  specialist?: string;
  resultHash?: string;
  resultUrl?: string;
  createdAt: number;
  settledAt?: number;
}

export interface Bid {
  jobId: string;
  specialist: string;
  bidPrice: bigint;
  timestamp: number;
}

export interface JobResult {
  jobId: string;
  resultHash: string;
  resultUrl: string;
  content?: string;
  specialist: string;
  deliveredAt: number;
}

export type MessageType = "JOB_POST" | "BID" | "ACCEPT" | "RESULT" | "PING";

export interface MessageEnvelope {
  type: MessageType;
  from: string;
  to: string;
  payload: JobPostMessage | BidMessage | AcceptMessage | ResultMessage;
  timestamp: number;
}

export interface JobPostMessage {
  jobId: string;
  description: string;
  requiredCapability: string;
  maxBudget: string;        // bigint as string
  deadline: number;
  plannerEndpoint: string;
}

export interface BidMessage {
  jobId: string;
  specialistAddress: string;
  specialistEndpoint: string;
  bidPrice: string;
}

export interface AcceptMessage {
  jobId: string;
  specialistAddress: string;
  agreedPrice: string;
}

export interface ResultMessage {
  jobId: string;
  resultHash: string;
  resultUrl: string;
}

export interface EscrowState {
  jobId: string;
  amount: bigint;
  planner: string;
  specialist: string;
  status: JobStatus;
  disputeStatus: DisputeStatus;
  keeperHubTaskId?: string;
  txHash?: string;
}

export interface AgentEvent {
  id: string;
  timestamp: number;
  type:
    | "AGENT_REGISTERED"
    | "JOB_POSTED"
    | "BID_RECEIVED"
    | "BID_ACCEPTED"
    | "INFERENCE_STARTED"
    | "INFERENCE_DONE"
    | "RESULT_SUBMITTED"
    | "DISPUTE_WINDOW_OPEN"
    | "PAYOUT_SETTLED"
    | "DISPUTE_RAISED"
    | "DISPUTE_RESOLVED"
    | "REPUTATION_UPDATED";
  agentName: string;
  jobId?: string;
  detail?: string;
  txHash?: string;
  explorerUrl?: string;
  keeperHubUrl?: string;
  reputationDelta?: number;
}
