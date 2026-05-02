import { expect } from "chai";
import { ethers, network } from "hardhat";
import { CapabilityRegistry, JobEscrow } from "../typechain-types";

const DAY = 86400n;
const DISPUTE_WINDOW = 30n;
const ZERO_HASH = ethers.ZeroHash;

async function mine(seconds: number) {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine", []);
}

async function blockTs(): Promise<bigint> {
  const block = await ethers.provider.getBlock("latest");
  return BigInt(block!.timestamp);
}

describe("JobEscrow", () => {
  let registry: CapabilityRegistry;
  let escrow: JobEscrow;
  let owner: any, planner: any, specialist: any, other: any;

  beforeEach(async () => {
    [owner, planner, specialist, other] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("CapabilityRegistry");
    registry = (await Registry.deploy()) as CapabilityRegistry;

    const Escrow = await ethers.getContractFactory("JobEscrow");
    escrow = (await Escrow.deploy(await registry.getAddress())) as JobEscrow;

    await registry.setJobEscrow(await escrow.getAddress());

    // register so updateReputation doesn't revert on "agent not registered"
    await registry.connect(specialist).register("Spec", ["research"], 0n, "ep");
    await registry.connect(planner).register("Plan", ["planning"], 0n, "ep");
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  async function openJob(budget = ethers.parseEther("0.5")) {
    const deadline = (await blockTs()) + DAY;
    const tx = await escrow.connect(planner).postJob(
      "do research",
      "research",
      deadline,
      ZERO_HASH,
      { value: budget }
    );
    const receipt = await tx.wait();
    const ev = receipt?.logs
      .map((l: any) => {
        try { return escrow.interface.parseLog(l); } catch { return null; }
      })
      .find((e: any) => e?.name === "JobPosted");
    return ev!.args.jobId as string;
  }

  async function assignJob(jobId: string, price = ethers.parseEther("0.3")) {
    await escrow.connect(specialist).bid(jobId, price);
    await escrow.connect(planner).acceptBid(jobId, specialist.address, price);
    return price;
  }

  async function deliverJob(jobId: string) {
    const hash = ethers.keccak256(ethers.toUtf8Bytes("result-content"));
    await escrow.connect(specialist).submitResult(jobId, hash, "0g://result");
    return hash;
  }

  // ── postJob ───────────────────────────────────────────────────────────────

  describe("postJob", () => {
    it("creates job and locks escrow", async () => {
      const jobId = await openJob();
      const job = await escrow.getJob(jobId);
      expect(job.status).to.equal(0); // OPEN
      expect(await escrow.escrow(jobId)).to.equal(ethers.parseEther("0.5"));
    });

    it("emits JobPosted", async () => {
      const deadline = (await blockTs()) + DAY;
      await expect(
        escrow.connect(planner).postJob("task", "cap", deadline, ZERO_HASH, {
          value: ethers.parseEther("0.1"),
        })
      ).to.emit(escrow, "JobPosted");
    });

    it("reverts with zero ETH", async () => {
      const deadline = (await blockTs()) + DAY;
      await expect(
        escrow.connect(planner).postJob("task", "cap", deadline, ZERO_HASH, { value: 0n })
      ).to.be.revertedWith("JobEscrow: budget required");
    });

    it("reverts with past deadline", async () => {
      const pastDeadline = (await blockTs()) - 1n;
      await expect(
        escrow.connect(planner).postJob("task", "cap", pastDeadline, ZERO_HASH, {
          value: ethers.parseEther("0.1"),
        })
      ).to.be.revertedWith("JobEscrow: deadline in past");
    });
  });

  // ── bid ───────────────────────────────────────────────────────────────────

  describe("bid", () => {
    it("records bid and emits BidReceived", async () => {
      const jobId = await openJob();
      await expect(escrow.connect(specialist).bid(jobId, ethers.parseEther("0.2")))
        .to.emit(escrow, "BidReceived")
        .withArgs(jobId, specialist.address, ethers.parseEther("0.2"));

      const bids = await escrow.getBids(jobId);
      expect(bids.length).to.equal(1);
      expect(bids[0].bidPrice).to.equal(ethers.parseEther("0.2"));
    });

    it("reverts if job not open", async () => {
      const jobId = await openJob();
      await assignJob(jobId);
      await expect(
        escrow.connect(other).bid(jobId, 100n)
      ).to.be.revertedWith("JobEscrow: job not open");
    });

    it("reverts if bid exceeds budget", async () => {
      const jobId = await openJob(ethers.parseEther("0.5"));
      await expect(
        escrow.connect(specialist).bid(jobId, ethers.parseEther("0.6"))
      ).to.be.revertedWith("JobEscrow: bid exceeds budget");
    });

    it("reverts after deadline", async () => {
      const jobId = await openJob();
      await mine(Number(DAY) + 1);
      await expect(
        escrow.connect(specialist).bid(jobId, 100n)
      ).to.be.revertedWith("JobEscrow: past deadline");
    });

    it("reverts if planner tries to bid", async () => {
      const jobId = await openJob();
      await expect(
        escrow.connect(planner).bid(jobId, 100n)
      ).to.be.revertedWith("JobEscrow: planner cannot bid");
    });
  });

  // ── acceptBid ─────────────────────────────────────────────────────────────

  describe("acceptBid", () => {
    it("transitions to ASSIGNED, refunds excess, emits BidAccepted", async () => {
      const jobId = await openJob(ethers.parseEther("0.5"));
      await escrow.connect(specialist).bid(jobId, ethers.parseEther("0.3"));

      const plannerBefore = await ethers.provider.getBalance(planner.address);
      const tx = await escrow
        .connect(planner)
        .acceptBid(jobId, specialist.address, ethers.parseEther("0.3"));
      const receipt = await tx.wait();
      const gas = receipt!.gasUsed * receipt!.gasPrice;
      const plannerAfter = await ethers.provider.getBalance(planner.address);

      expect(plannerAfter).to.be.closeTo(
        plannerBefore + ethers.parseEther("0.2") - gas,
        ethers.parseEther("0.001")
      );
      expect(await escrow.escrow(jobId)).to.equal(ethers.parseEther("0.3"));
      expect((await escrow.getJob(jobId)).status).to.equal(1); // ASSIGNED
    });

    it("reverts if not planner", async () => {
      const jobId = await openJob();
      await escrow.connect(specialist).bid(jobId, 100n);
      await expect(
        escrow.connect(other).acceptBid(jobId, specialist.address, 100n)
      ).to.be.revertedWith("JobEscrow: not planner");
    });

    it("reverts if bid not found (wrong price)", async () => {
      const jobId = await openJob();
      await escrow.connect(specialist).bid(jobId, ethers.parseEther("0.2"));
      await expect(
        escrow.connect(planner).acceptBid(jobId, specialist.address, ethers.parseEther("0.3"))
      ).to.be.revertedWith("JobEscrow: bid not found");
    });
  });

  // ── OPEN → CANCELLED ─────────────────────────────────────────────────────

  describe("cancelJob", () => {
    it("transitions OPEN→CANCELLED, refunds planner, emits JobCancelled", async () => {
      const jobId = await openJob(ethers.parseEther("0.5"));
      const before = await ethers.provider.getBalance(planner.address);
      const tx = await escrow.connect(planner).cancelJob(jobId);
      const receipt = await tx.wait();
      const gas = receipt!.gasUsed * receipt!.gasPrice;
      const after = await ethers.provider.getBalance(planner.address);

      expect((await escrow.getJob(jobId)).status).to.equal(4); // CANCELLED
      expect(after).to.be.closeTo(
        before + ethers.parseEther("0.5") - gas,
        ethers.parseEther("0.001")
      );
      expect(await escrow.escrow(jobId)).to.equal(0n);
      await expect(tx).to.emit(escrow, "JobCancelled").withArgs(jobId);
    });

    it("reverts if job not open (already assigned)", async () => {
      const jobId = await openJob();
      await assignJob(jobId);
      await expect(escrow.connect(planner).cancelJob(jobId)).to.be.revertedWith(
        "JobEscrow: can only cancel open jobs"
      );
    });

    it("reverts if not planner", async () => {
      const jobId = await openJob();
      await expect(escrow.connect(other).cancelJob(jobId)).to.be.revertedWith(
        "JobEscrow: not planner"
      );
    });
  });

  // ── submitResult ──────────────────────────────────────────────────────────

  describe("submitResult", () => {
    it("transitions ASSIGNED→DELIVERED, sets dispute window, emits JobDelivered", async () => {
      const jobId = await openJob();
      await assignJob(jobId);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("content"));

      await expect(
        escrow.connect(specialist).submitResult(jobId, hash, "0g://result")
      ).to.emit(escrow, "JobDelivered");

      const job = await escrow.getJob(jobId);
      expect(job.status).to.equal(2); // DELIVERED
      expect(job.resultHash).to.equal(hash);
      expect(job.resultUrl).to.equal("0g://result");
      expect(job.disputeWindowEnd).to.be.gt(0n);
    });

    it("reverts if not specialist", async () => {
      const jobId = await openJob();
      await assignJob(jobId);
      await expect(
        escrow.connect(other).submitResult(jobId, ZERO_HASH, "url")
      ).to.be.revertedWith("JobEscrow: not specialist");
    });

    it("reverts after deadline", async () => {
      const jobId = await openJob();
      await assignJob(jobId);
      await mine(Number(DAY) + 1);
      await expect(
        escrow.connect(specialist).submitResult(jobId, ZERO_HASH, "url")
      ).to.be.revertedWith("JobEscrow: past deadline");
    });
  });

  // ── DELIVERED → SETTLED (happy path) ─────────────────────────────────────

  describe("releasePayout", () => {
    it("settles after window, pays specialist, updates reputation success", async () => {
      const jobId = await openJob();
      await assignJob(jobId, ethers.parseEther("0.3"));
      await deliverJob(jobId);
      await mine(Number(DISPUTE_WINDOW) + 1);

      const specBefore = await ethers.provider.getBalance(specialist.address);
      const tx = await escrow.connect(other).releasePayout(jobId); // anyone can call
      await tx.wait();

      expect((await escrow.getJob(jobId)).status).to.equal(3); // SETTLED

      const specAfter = await ethers.provider.getBalance(specialist.address);
      expect(specAfter).to.be.closeTo(
        specBefore + ethers.parseEther("0.3"),
        ethers.parseEther("0.001")
      );

      const rep = (await registry.getProfile(specialist.address)).reputation;
      expect(rep.successfulJobs).to.equal(1n);
      expect(rep.score).to.equal(100n);
    });

    it("reverts if dispute window still open", async () => {
      const jobId = await openJob();
      await assignJob(jobId);
      await deliverJob(jobId);
      await expect(
        escrow.connect(other).releasePayout(jobId)
      ).to.be.revertedWith("JobEscrow: dispute window still open");
    });

    it("reverts if job not delivered", async () => {
      const jobId = await openJob();
      await expect(
        escrow.connect(other).releasePayout(jobId)
      ).to.be.revertedWith("JobEscrow: not in delivered state");
    });
  });

  // ── DELIVERED → DISPUTED ─────────────────────────────────────────────────

  describe("raiseDispute", () => {
    it("transitions DELIVERED→DISPUTED, emits DisputeRaised", async () => {
      const jobId = await openJob();
      await assignJob(jobId);
      await deliverJob(jobId);

      await expect(escrow.connect(planner).raiseDispute(jobId))
        .to.emit(escrow, "DisputeRaised")
        .withArgs(jobId, planner.address);

      expect((await escrow.getJob(jobId)).status).to.equal(5); // DISPUTED
      expect((await escrow.getJob(jobId)).disputeStatus).to.equal(1); // RAISED
    });

    it("reverts if window closed", async () => {
      const jobId = await openJob();
      await assignJob(jobId);
      await deliverJob(jobId);
      await mine(Number(DISPUTE_WINDOW) + 1);
      await expect(
        escrow.connect(planner).raiseDispute(jobId)
      ).to.be.revertedWith("JobEscrow: dispute window closed");
    });

    it("reverts if not planner", async () => {
      const jobId = await openJob();
      await assignJob(jobId);
      await deliverJob(jobId);
      await expect(
        escrow.connect(other).raiseDispute(jobId)
      ).to.be.revertedWith("JobEscrow: not planner");
    });

    it("reverts if job not delivered", async () => {
      const jobId = await openJob();
      await assignJob(jobId);
      await expect(
        escrow.connect(planner).raiseDispute(jobId)
      ).to.be.revertedWith("JobEscrow: not delivered");
    });
  });

  // ── DISPUTED → FAILED (specialist fault) ─────────────────────────────────

  describe("resolveDispute — specialist fault", () => {
    it("refunds planner, sets FAILED, penalises specialist reputation", async () => {
      const jobId = await openJob(ethers.parseEther("0.5"));
      await assignJob(jobId, ethers.parseEther("0.3"));
      await deliverJob(jobId);
      await escrow.connect(planner).raiseDispute(jobId);

      const plannerBefore = await ethers.provider.getBalance(planner.address);
      const tx = await escrow.connect(owner).resolveDispute(jobId, true);
      const receipt = await tx.wait();

      const job = await escrow.getJob(jobId);
      expect(job.status).to.equal(6); // FAILED
      expect(job.disputeStatus).to.equal(2); // RESOLVED_SPECIALIST_FAULT
      expect(await escrow.escrow(jobId)).to.equal(0n);

      const rep = (await registry.getProfile(specialist.address)).reputation;
      expect(rep.score).to.equal(0n);
      expect(rep.totalJobs).to.equal(1n);
      expect(rep.successfulJobs).to.equal(0n);

      await expect(tx).to.emit(escrow, "DisputeResolved").withArgs(jobId, true);
    });

    it("reverts if not owner", async () => {
      const jobId = await openJob();
      await assignJob(jobId);
      await deliverJob(jobId);
      await escrow.connect(planner).raiseDispute(jobId);
      await expect(
        escrow.connect(other).resolveDispute(jobId, true)
      ).to.be.revertedWith("JobEscrow: not owner");
    });
  });

  // ── DISPUTED → SETTLED (planner fault) ───────────────────────────────────

  describe("resolveDispute — planner fault", () => {
    it("pays specialist, sets SETTLED, penalises planner reputation", async () => {
      const jobId = await openJob(ethers.parseEther("0.5"));
      await assignJob(jobId, ethers.parseEther("0.3"));
      await deliverJob(jobId);
      await escrow.connect(planner).raiseDispute(jobId);

      const specBefore = await ethers.provider.getBalance(specialist.address);
      const tx = await escrow.connect(owner).resolveDispute(jobId, false);
      await tx.wait();

      const job = await escrow.getJob(jobId);
      expect(job.status).to.equal(3); // SETTLED
      expect(job.disputeStatus).to.equal(3); // RESOLVED_PLANNER_FAULT

      const specAfter = await ethers.provider.getBalance(specialist.address);
      expect(specAfter).to.be.closeTo(
        specBefore + ethers.parseEther("0.3"),
        ethers.parseEther("0.001")
      );

      const rep = (await registry.getProfile(planner.address)).reputation;
      expect(rep.score).to.equal(0n);
      expect(rep.totalJobs).to.equal(1n);
    });
  });

  // ── ASSIGNED → FAILED (missed deadline) ──────────────────────────────────

  describe("markFailed", () => {
    it("transitions ASSIGNED→FAILED, refunds planner, penalises specialist", async () => {
      const jobId = await openJob(ethers.parseEther("0.5"));
      await assignJob(jobId, ethers.parseEther("0.3"));
      await mine(Number(DAY) + 1);

      const plannerBefore = await ethers.provider.getBalance(planner.address);
      const tx = await escrow.connect(other).markFailed(jobId);
      await tx.wait();

      expect((await escrow.getJob(jobId)).status).to.equal(6); // FAILED

      const plannerAfter = await ethers.provider.getBalance(planner.address);
      expect(plannerAfter).to.be.closeTo(
        plannerBefore + ethers.parseEther("0.3"),
        ethers.parseEther("0.001")
      );

      const rep = (await registry.getProfile(specialist.address)).reputation;
      expect(rep.score).to.equal(0n);
      expect(rep.totalJobs).to.equal(1n);
    });

    it("reverts if deadline not passed", async () => {
      const jobId = await openJob();
      await assignJob(jobId);
      await expect(escrow.connect(other).markFailed(jobId)).to.be.revertedWith(
        "JobEscrow: deadline not passed"
      );
    });

    it("reverts if job not assigned", async () => {
      const jobId = await openJob();
      await mine(Number(DAY) + 1);
      await expect(escrow.connect(other).markFailed(jobId)).to.be.revertedWith(
        "JobEscrow: job not assigned"
      );
    });
  });

  // ── Sub-jobs ──────────────────────────────────────────────────────────────

  describe("sub-jobs", () => {
    it("links child to parent and tracks childJobIds", async () => {
      const parentId = await openJob();
      await assignJob(parentId);

      const deadline = (await blockTs()) + DAY;
      const tx = await escrow.connect(planner).postJob(
        "sub-task",
        "research",
        deadline,
        parentId,
        { value: ethers.parseEther("0.1") }
      );
      const receipt = await tx.wait();
      const ev = receipt?.logs
        .map((l: any) => {
          try { return escrow.interface.parseLog(l); } catch { return null; }
        })
        .find((e: any) => e?.name === "JobPosted");
      const childId = ev!.args.jobId;

      expect((await escrow.getJob(parentId)).childJobIds).to.include(childId);
      expect((await escrow.getJob(childId)).parentJobId).to.equal(parentId);
    });

    it("parent auto-settles when all children reach terminal state", async () => {
      const parentId = await openJob(ethers.parseEther("0.5"));
      await assignJob(parentId, ethers.parseEther("0.1"));

      // Post child job
      const deadline = (await blockTs()) + DAY;
      const tx = await escrow.connect(planner).postJob(
        "sub", "research", deadline, parentId,
        { value: ethers.parseEther("0.1") }
      );
      const receipt = await tx.wait();
      const ev = receipt?.logs
        .map((l: any) => {
          try { return escrow.interface.parseLog(l); } catch { return null; }
        })
        .find((e: any) => e?.name === "JobPosted");
      const childId = ev!.args.jobId;

      // Assign + deliver + release child
      await escrow.connect(specialist).bid(childId, ethers.parseEther("0.1"));
      await escrow.connect(planner).acceptBid(childId, specialist.address, ethers.parseEther("0.1"));
      const hash = ethers.keccak256(ethers.toUtf8Bytes("child-result"));
      await escrow.connect(specialist).submitResult(childId, hash, "0g://child");
      await mine(Number(DISPUTE_WINDOW) + 1);
      await escrow.connect(other).releasePayout(childId);

      // Parent should be SETTLED via _trySettleParent
      expect((await escrow.getJob(parentId)).status).to.equal(3); // SETTLED
    });
  });

  // ── Reputation value-weighting end-to-end ────────────────────────────────

  describe("reputation value-weighting", () => {
    it("0.1 ETH success + 0.01 ETH failure = score 90, not 50", async () => {
      // Job 1: 0.1 ETH, succeeds
      const job1 = await openJob(ethers.parseEther("0.1"));
      await assignJob(job1, ethers.parseEther("0.1"));
      await deliverJob(job1);
      await mine(Number(DISPUTE_WINDOW) + 1);
      await escrow.connect(other).releasePayout(job1);

      // Job 2: 0.01 ETH, fails (missed deadline — set short deadline)
      const deadline2 = (await blockTs()) + 10n;
      const tx = await escrow.connect(planner).postJob(
        "job2", "research", deadline2, ZERO_HASH,
        { value: ethers.parseEther("0.01") }
      );
      const receipt = await tx.wait();
      const ev = receipt?.logs
        .map((l: any) => {
          try { return escrow.interface.parseLog(l); } catch { return null; }
        })
        .find((e: any) => e?.name === "JobPosted");
      const job2 = ev!.args.jobId;

      await escrow.connect(specialist).bid(job2, ethers.parseEther("0.01"));
      await escrow.connect(planner).acceptBid(job2, specialist.address, ethers.parseEther("0.01"));
      await mine(20);
      await escrow.connect(other).markFailed(job2);

      const rep = (await registry.getProfile(specialist.address)).reputation;
      // weightedSuccesses = 0.1e18, weightedTotal = 0.11e18
      // score = (0.1e18 * 100) / 0.11e18 = 90
      expect(rep.score).to.equal(90n);
    });
  });
});
