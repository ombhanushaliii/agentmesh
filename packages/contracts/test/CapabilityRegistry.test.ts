import { expect } from "chai";
import { ethers, network } from "hardhat";
import { CapabilityRegistry, JobEscrow } from "../typechain-types";

describe("CapabilityRegistry", () => {
  let registry: CapabilityRegistry;
  let escrow: JobEscrow;
  let owner: any, agent1: any, agent2: any, stranger: any;

  beforeEach(async () => {
    [owner, agent1, agent2, stranger] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("CapabilityRegistry");
    registry = (await Registry.deploy()) as CapabilityRegistry;

    const Escrow = await ethers.getContractFactory("JobEscrow");
    escrow = (await Escrow.deploy(await registry.getAddress())) as JobEscrow;

    await registry.setJobEscrow(await escrow.getAddress());
  });

  async function asEscrow(): Promise<[any, string]> {
    const escrowAddr = await escrow.getAddress();
    await network.provider.send("hardhat_setBalance", [escrowAddr, "0x8AC7230489E80000"]);
    await network.provider.send("hardhat_impersonateAccount", [escrowAddr]);
    return [await ethers.getSigner(escrowAddr), escrowAddr];
  }

  async function stopEscrow(addr: string) {
    await network.provider.send("hardhat_stopImpersonatingAccount", [addr]);
  }

  async function updateRepAsEscrow(agent: string, success: boolean, value: bigint) {
    const [signer, addr] = await asEscrow();
    await registry.connect(signer).updateReputation(agent, success, value);
    await stopEscrow(addr);
  }

  describe("register", () => {
    it("stores profile on first registration", async () => {
      await registry.connect(agent1).register(
        "ResearcherAgent",
        ["research", "analysis"],
        ethers.parseEther("0.01"),
        "axl://agent1"
      );
      const p = await registry.getProfile(agent1.address);
      expect(p.name).to.equal("ResearcherAgent");
      expect(p.capabilities).to.deep.equal(["research", "analysis"]);
      expect(p.pricePerJob).to.equal(ethers.parseEther("0.01"));
      expect(p.endpoint).to.equal("axl://agent1");
      expect(p.available).to.be.true;
      expect(p.agentAddress).to.equal(agent1.address);
    });

    it("emits AgentRegistered", async () => {
      await expect(
        registry.connect(agent1).register("Agent1", ["cap1"], 100n, "ep1")
      )
        .to.emit(registry, "AgentRegistered")
        .withArgs(agent1.address, "Agent1", ["cap1"]);
    });

    it("updates profile on re-register", async () => {
      await registry.connect(agent1).register("v1", ["cap1"], 100n, "ep1");
      await registry.connect(agent1).register("v2", ["cap2", "cap3"], 200n, "ep2");
      const p = await registry.getProfile(agent1.address);
      expect(p.name).to.equal("v2");
      expect(p.capabilities).to.deep.equal(["cap2", "cap3"]);
    });

    it("preserves registeredAt across re-register", async () => {
      await registry.connect(agent1).register("v1", ["cap1"], 100n, "ep1");
      const { registeredAt } = await registry.getProfile(agent1.address);
      await registry.connect(agent1).register("v2", ["cap2"], 200n, "ep2");
      const { registeredAt: after } = await registry.getProfile(agent1.address);
      expect(after).to.equal(registeredAt);
    });
  });

  describe("setAvailable", () => {
    it("toggles availability", async () => {
      await registry.connect(agent1).register("A1", ["cap1"], 0n, "ep");
      await registry.connect(agent1).setAvailable(false);
      expect((await registry.getProfile(agent1.address)).available).to.be.false;
      await registry.connect(agent1).setAvailable(true);
      expect((await registry.getProfile(agent1.address)).available).to.be.true;
    });

    it("reverts for unregistered agent", async () => {
      await expect(
        registry.connect(stranger).setAvailable(false)
      ).to.be.revertedWith("CapabilityRegistry: not registered");
    });
  });

  describe("lookup", () => {
    beforeEach(async () => {
      await registry.connect(agent1).register("A1", ["research", "analysis"], 0n, "ep1");
      await registry.connect(agent2).register("A2", ["research"], 0n, "ep2");
    });

    it("returns agents matching the capability", async () => {
      const results = await registry.lookup("research");
      expect(results.length).to.equal(2);
    });

    it("filters by specific capability", async () => {
      const results = await registry.lookup("analysis");
      expect(results.length).to.equal(1);
      expect(results[0].agentAddress).to.equal(agent1.address);
    });

    it("excludes unavailable agents", async () => {
      await registry.connect(agent1).setAvailable(false);
      const results = await registry.lookup("research");
      expect(results.length).to.equal(1);
      expect(results[0].agentAddress).to.equal(agent2.address);
    });

    it("returns empty array for unknown capability", async () => {
      const results = await registry.lookup("nonexistent");
      expect(results.length).to.equal(0);
    });
  });

  describe("updateReputation", () => {
    beforeEach(async () => {
      await registry.connect(agent1).register("A1", ["cap1"], 0n, "ep1");
    });

    it("reverts if caller is not JobEscrow", async () => {
      await expect(
        registry.connect(stranger).updateReputation(agent1.address, true, ethers.parseEther("0.1"))
      ).to.be.revertedWith("CapabilityRegistry: caller is not JobEscrow");
    });

    it("reverts for unregistered agent", async () => {
      const [signer, addr] = await asEscrow();
      await expect(
        registry.connect(signer).updateReputation(stranger.address, true, 100n)
      ).to.be.revertedWith("CapabilityRegistry: agent not registered");
      await stopEscrow(addr);
    });

    it("calculates score 100 on first success", async () => {
      await updateRepAsEscrow(agent1.address, true, ethers.parseEther("0.1"));
      const rep = (await registry.getProfile(agent1.address)).reputation;
      expect(rep.score).to.equal(100n);
      expect(rep.totalJobs).to.equal(1n);
      expect(rep.successfulJobs).to.equal(1n);
    });

    it("calculates score 0 on first failure", async () => {
      await updateRepAsEscrow(agent1.address, false, ethers.parseEther("0.1"));
      const rep = (await registry.getProfile(agent1.address)).reputation;
      expect(rep.score).to.equal(0n);
      expect(rep.totalJobs).to.equal(1n);
      expect(rep.successfulJobs).to.equal(0n);
    });

    // Key invariant: 0.1 ETH success + 0.01 ETH failure → score 90, not 50
    it("value-weighted: 0.1 ETH success + 0.01 ETH failure = score 90", async () => {
      await updateRepAsEscrow(agent1.address, true, ethers.parseEther("0.1"));
      await updateRepAsEscrow(agent1.address, false, ethers.parseEther("0.01"));

      const rep = (await registry.getProfile(agent1.address)).reputation;
      // score = (0.1e18 * 100) / 0.11e18 = 90 (integer division)
      expect(rep.score).to.equal(90n);
      expect(rep.totalJobs).to.equal(2n);
      expect(rep.weightedSuccesses).to.equal(ethers.parseEther("0.1"));
      expect(rep.weightedTotal).to.equal(ethers.parseEther("0.11"));
    });

    it("emits ReputationUpdated", async () => {
      const [signer, addr] = await asEscrow();
      await expect(
        registry.connect(signer).updateReputation(
          agent1.address, true, ethers.parseEther("0.1")
        )
      )
        .to.emit(registry, "ReputationUpdated")
        .withArgs(agent1.address, 100n, true, ethers.parseEther("0.1"));
      await stopEscrow(addr);
    });
  });
});
