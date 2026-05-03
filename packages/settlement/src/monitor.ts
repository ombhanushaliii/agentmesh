import { ethers } from 'ethers';
import { JobEscrowABI, addresses } from '@agentmesh/contracts';

export class JobEventMonitor {
  private provider: ethers.JsonRpcProvider;
  private contract: ethers.Contract;
  private isRunning: boolean = false;

  constructor(rpcUrl: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.contract = new ethers.Contract(addresses.JobEscrow, JobEscrowABI, this.provider);
  }

  async start(
    onDelivered: (jobId: string, specialist: string, amount: bigint) => Promise<void>,
    onFailed: (jobId: string, specialist: string) => Promise<void>
  ): Promise<void> {
    this.isRunning = true;

    // Use string event name — ethers v6 filter objects pass ContractEventPayload as first arg
    this.contract.on('JobDelivered', async (jobId: string, resultHash: string, resultUrl: string, disputeWindowEnd: bigint) => {
      if (!this.isRunning) return;

      const now = Math.floor(Date.now() / 1000);
      const delay = Math.max(0, Number(disputeWindowEnd) - now);

      await new Promise(resolve => setTimeout(resolve, delay * 1000));

      const job = await this.contract.getJob(jobId);
      if (job.status === 2n) {
        const amount = await this.contract.escrow(jobId);
        await onDelivered(jobId, job.specialist as string, amount);
      }
    });

    this.contract.on('JobFailed', async (jobId: string, specialist: string) => {
      if (!this.isRunning) return;
      await onFailed(jobId, specialist);
    });
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.contract.removeAllListeners();
  }
}
