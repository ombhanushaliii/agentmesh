import hre from "hardhat";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

async function main() {
  const { ethers, artifacts } = hre;
  const [deployer] = await ethers.getSigners();

  console.log("Deployer:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "0G");

  // 1. Deploy CapabilityRegistry
  const Registry = await ethers.getContractFactory("CapabilityRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("CapabilityRegistry:", registryAddress);

  // 2. Deploy JobEscrow
  const Escrow = await ethers.getContractFactory("JobEscrow");
  const escrow = await Escrow.deploy(registryAddress);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log("JobEscrow:", escrowAddress);

  // 3. Wire: registry must know escrow address so updateReputation is callable
  const wireTx = await registry.setJobEscrow(escrowAddress);
  await wireTx.wait();
  console.log("Registry wired to escrow ✓");

  // 4. Write addresses.json
  const network = await ethers.provider.getNetwork();
  const addresses = {
    CapabilityRegistry: registryAddress,
    JobEscrow: escrowAddress,
    network: network.name,
    chainId: Number(network.chainId),
    deployedAt: new Date().toISOString(),
  };

  const deploymentsDir = join(__dirname, "../deployments");
  mkdirSync(deploymentsDir, { recursive: true });
  writeFileSync(
    join(deploymentsDir, "addresses.json"),
    JSON.stringify(addresses, null, 2)
  );
  console.log("Wrote deployments/addresses.json");

  // 5. Copy ABIs
  const abiDir = join(__dirname, "../abis");
  mkdirSync(abiDir, { recursive: true });

  const registryArtifact = await artifacts.readArtifact("CapabilityRegistry");
  writeFileSync(
    join(abiDir, "CapabilityRegistry.json"),
    JSON.stringify(registryArtifact.abi, null, 2)
  );

  const escrowArtifact = await artifacts.readArtifact("JobEscrow");
  writeFileSync(
    join(abiDir, "JobEscrow.json"),
    JSON.stringify(escrowArtifact.abi, null, 2)
  );
  console.log("Wrote abis/");

  console.log("\nDone. Update CLAUDE.md contract addresses:");
  console.log("  CapabilityRegistry:", registryAddress);
  console.log("  JobEscrow:", escrowAddress);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
