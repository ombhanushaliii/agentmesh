import type { AgentEvent } from '@agentmesh/types';
import { JobEventMonitor } from './monitor';

type ExecuteContractCallInput = {
  network: string;
  contractAddress: string;
  abiFunction: string;
  functionArgs: string;
};

type ExecuteContractCallResult = {
  transactionHash: string;
  taskId: string;
};

type ExecuteContractCall = (
  input: ExecuteContractCallInput
) => Promise<ExecuteContractCallResult>;

export interface KeeperHubSettlementConfig {
  rpcUrl: string;
  executeContractCall?: ExecuteContractCall;
  network?: string;
  jobEscrowAddress?: string;
}

const missingKeeperHubExecutor: ExecuteContractCall = async () => {
  throw new Error('KeeperHub MCP executor is not configured');
};

export class KeeperHubSettlement {
  private monitor: JobEventMonitor;
  private executeContractCall: ExecuteContractCall;
  private network: string;
  private jobEscrowAddress: string;

  constructor(config: KeeperHubSettlementConfig) {
    this.monitor = new JobEventMonitor(config.rpcUrl);
    this.executeContractCall = config.executeContractCall ?? missingKeeperHubExecutor;
    this.network = config.network ?? '16602';
    this.jobEscrowAddress = config.jobEscrowAddress ?? 'JobEscrowAddress';
  }

  async start(): Promise<void> {
    await this.monitor.start(
      (jobId, specialist, amount) => this.settle(jobId, specialist, amount),
      (jobId, specialist) => this.markFail(jobId, specialist)
    );
  }

  private async settle(jobId: string, specialist: string, amount: bigint): Promise<void> {
    try {
      const result = await this.executeContractCall({
        network: this.network,
        contractAddress: this.jobEscrowAddress,
        abiFunction: 'releasePayout',
        functionArgs: JSON.stringify([jobId])
      });

      const txHash = result.transactionHash;
      const auditUrl = `https://keeperhub.ai/audit/${result.taskId}`;

      console.log(`[Settlement] Payout released for job ${jobId}. Tx: ${txHash}`);

      this.emitEvent({
        id: this.buildEventId(jobId, 'PAYOUT_SETTLED'),
        timestamp: Date.now(),
        type: 'PAYOUT_SETTLED',
        agentName: 'keeperhub-settlement',
        jobId,
        detail: `Payout released to ${specialist} (${amount.toString()})`,
        txHash,
        keeperHubUrl: auditUrl
      });
    } catch (e) {
      console.error(`[Settlement] Failed to settle job ${jobId}:`, e);
    }
  }

  private async markFail(jobId: string, specialist: string): Promise<void> {
    try {
      const result = await this.executeContractCall({
        network: this.network,
        contractAddress: this.jobEscrowAddress,
        abiFunction: 'markFailed',
        functionArgs: JSON.stringify([jobId])
      });

      this.emitEvent({
        id: this.buildEventId(jobId, 'REPUTATION_UPDATED'),
        timestamp: Date.now(),
        type: 'REPUTATION_UPDATED',
        agentName: 'keeperhub-settlement',
        jobId,
        detail: `Job ${jobId} marked failed for specialist ${specialist}`,
        txHash: result.transactionHash,
        reputationDelta: -10
      });
    } catch (e) {
      console.error(`[Settlement] Failed to mark job ${jobId} as failed:`, e);
    }
  }

  private buildEventId(jobId: string, type: AgentEvent['type']): string {
    return `${jobId}:${type}:${Date.now()}`;
  }

  private emitEvent(event: AgentEvent) {
    console.log(`[Event] ${event.type}:`, event);
  }

  async stop(): Promise<void> {
    await this.monitor.stop();
  }
}
