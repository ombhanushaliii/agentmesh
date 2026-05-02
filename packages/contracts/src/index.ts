import CapabilityRegistryABI from "../abis/CapabilityRegistry.json";
import JobEscrowABI from "../abis/JobEscrow.json";
import deployedAddresses from "../deployments/addresses.json";

export { CapabilityRegistryABI, JobEscrowABI };

export const addresses = {
  CapabilityRegistry: deployedAddresses.CapabilityRegistry as `0x${string}`,
  JobEscrow: deployedAddresses.JobEscrow as `0x${string}`,
  chainId: deployedAddresses.chainId,
  network: deployedAddresses.network,
};
