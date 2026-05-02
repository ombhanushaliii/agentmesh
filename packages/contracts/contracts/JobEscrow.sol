// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICapabilityRegistry {
    function updateReputation(address agent, bool success, uint256 jobValue) external;
}

contract JobEscrow {
    // ── Reentrancy guard ────────────────────────────────────────────────────
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    // ── Types ───────────────────────────────────────────────────────────────
    enum JobStatus { OPEN, ASSIGNED, DELIVERED, SETTLED, CANCELLED, DISPUTED, FAILED }
    enum DisputeStatus { NONE, RAISED, RESOLVED_SPECIALIST_FAULT, RESOLVED_PLANNER_FAULT }

    struct Job {
        bytes32 id;
        bytes32 parentJobId;        // bytes32(0) for top-level jobs
        address planner;
        string description;
        string requiredCapability;
        uint256 maxBudget;
        uint256 agreedPrice;        // set after acceptBid
        uint256 deadline;
        JobStatus status;
        DisputeStatus disputeStatus;
        address specialist;
        bytes32 resultHash;
        string resultUrl;
        uint256 createdAt;
        uint256 settledAt;
        uint256 disputeWindowEnd;
        bytes32[] childJobIds;
    }

    struct Bid {
        bytes32 jobId;
        address specialist;
        uint256 bidPrice;
        uint256 timestamp;
    }

    // ── State ───────────────────────────────────────────────────────────────
    address public owner;
    ICapabilityRegistry public registry;
    uint256 public constant DISPUTE_WINDOW = 30; // seconds

    uint256 private jobCounter;
    mapping(bytes32 => Job) private jobs;
    mapping(bytes32 => Bid[]) private bids;
    mapping(bytes32 => uint256) public escrow;

    // ── Events ──────────────────────────────────────────────────────────────
    event JobPosted(bytes32 indexed jobId, address indexed planner, string capability, uint256 maxBudget, bytes32 parentJobId);
    event BidReceived(bytes32 indexed jobId, address indexed specialist, uint256 bidPrice);
    event BidAccepted(bytes32 indexed jobId, address indexed specialist, uint256 agreedPrice);
    event JobDelivered(bytes32 indexed jobId, bytes32 resultHash, string resultUrl, uint256 disputeWindowEnd);
    event DisputeRaised(bytes32 indexed jobId, address indexed planner);
    event DisputeResolved(bytes32 indexed jobId, bool specialistFault);
    event PayoutReleased(bytes32 indexed jobId, address indexed specialist, uint256 amount);
    event JobFailed(bytes32 indexed jobId, address indexed specialist);
    event JobCancelled(bytes32 indexed jobId);

    constructor(address _registry) {
        require(_registry != address(0), "JobEscrow: zero registry");
        owner = msg.sender;
        registry = ICapabilityRegistry(_registry);
        _status = _NOT_ENTERED;
    }

    // ── Core lifecycle ──────────────────────────────────────────────────────

    // Sub-job note: each postJob call is payable regardless of parentJobId.
    // The parent-child relationship is tracked for settlement ordering only;
    // each job carries its own escrow funded by the planner at call time.
    function postJob(
        string calldata description,
        string calldata capability,
        uint256 deadline,
        bytes32 parentJobId
    ) external payable returns (bytes32) {
        require(msg.value > 0, "JobEscrow: budget required");
        require(deadline > block.timestamp, "JobEscrow: deadline in past");

        bytes32 jobId = keccak256(
            abi.encodePacked(msg.sender, block.timestamp, jobCounter++)
        );

        Job storage job = jobs[jobId];
        job.id = jobId;
        job.parentJobId = parentJobId;
        job.planner = msg.sender;
        job.description = description;
        job.requiredCapability = capability;
        job.maxBudget = msg.value;
        job.deadline = deadline;
        job.status = JobStatus.OPEN;
        job.disputeStatus = DisputeStatus.NONE;
        job.createdAt = block.timestamp;

        escrow[jobId] = msg.value;

        if (parentJobId != bytes32(0)) {
            require(jobs[parentJobId].planner != address(0), "JobEscrow: parent not found");
            jobs[parentJobId].childJobIds.push(jobId);
        }

        emit JobPosted(jobId, msg.sender, capability, msg.value, parentJobId);
        return jobId;
    }

    function bid(bytes32 jobId, uint256 bidPrice) external {
        Job storage job = jobs[jobId];
        require(job.status == JobStatus.OPEN, "JobEscrow: job not open");
        require(bidPrice <= job.maxBudget, "JobEscrow: bid exceeds budget");
        require(block.timestamp < job.deadline, "JobEscrow: past deadline");
        require(msg.sender != job.planner, "JobEscrow: planner cannot bid");

        bids[jobId].push(Bid({
            jobId: jobId,
            specialist: msg.sender,
            bidPrice: bidPrice,
            timestamp: block.timestamp
        }));

        emit BidReceived(jobId, msg.sender, bidPrice);
    }

    function acceptBid(bytes32 jobId, address specialist, uint256 agreedPrice) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.planner == msg.sender, "JobEscrow: not planner");
        require(job.status == JobStatus.OPEN, "JobEscrow: job not open");

        // Require exact match on (specialist, bidPrice)
        bool found = false;
        Bid[] storage jobBids = bids[jobId];
        for (uint256 i = 0; i < jobBids.length; i++) {
            if (jobBids[i].specialist == specialist && jobBids[i].bidPrice == agreedPrice) {
                found = true;
                break;
            }
        }
        require(found, "JobEscrow: bid not found");

        uint256 excess = job.maxBudget - agreedPrice;
        job.agreedPrice = agreedPrice;
        job.specialist = specialist;
        job.status = JobStatus.ASSIGNED;
        escrow[jobId] = agreedPrice;

        emit BidAccepted(jobId, specialist, agreedPrice);

        if (excess > 0) {
            _sendEth(job.planner, excess);
        }
    }

    function submitResult(
        bytes32 jobId,
        bytes32 resultHash,
        string calldata resultUrl
    ) external {
        Job storage job = jobs[jobId];
        require(job.specialist == msg.sender, "JobEscrow: not specialist");
        require(job.status == JobStatus.ASSIGNED, "JobEscrow: job not assigned");
        require(block.timestamp <= job.deadline, "JobEscrow: past deadline");

        job.resultHash = resultHash;
        job.resultUrl = resultUrl;
        job.status = JobStatus.DELIVERED;
        job.disputeWindowEnd = block.timestamp + DISPUTE_WINDOW;

        emit JobDelivered(jobId, resultHash, resultUrl, job.disputeWindowEnd);
    }

    function raiseDispute(bytes32 jobId) external {
        Job storage job = jobs[jobId];
        require(job.planner == msg.sender, "JobEscrow: not planner");
        require(job.status == JobStatus.DELIVERED, "JobEscrow: not delivered");
        require(block.timestamp <= job.disputeWindowEnd, "JobEscrow: dispute window closed");

        job.status = JobStatus.DISPUTED;
        job.disputeStatus = DisputeStatus.RAISED;

        emit DisputeRaised(jobId, msg.sender);
    }

    // Owner applies the off-chain hash/URL check rule before calling this.
    // specialistFault = true  → hash mismatch / empty URL → refund planner, penalise specialist
    // specialistFault = false → hash matches → pay specialist, penalise planner
    function resolveDispute(bytes32 jobId, bool specialistFault) external nonReentrant {
        require(msg.sender == owner, "JobEscrow: not owner");
        Job storage job = jobs[jobId];
        require(job.status == JobStatus.DISPUTED, "JobEscrow: not disputed");

        uint256 amount = escrow[jobId];
        escrow[jobId] = 0;
        job.settledAt = block.timestamp;

        emit DisputeResolved(jobId, specialistFault);

        if (specialistFault) {
            job.disputeStatus = DisputeStatus.RESOLVED_SPECIALIST_FAULT;
            job.status = JobStatus.FAILED;
            registry.updateReputation(job.specialist, false, job.agreedPrice);
            _sendEth(job.planner, amount);
        } else {
            job.disputeStatus = DisputeStatus.RESOLVED_PLANNER_FAULT;
            job.status = JobStatus.SETTLED;
            registry.updateReputation(job.planner, false, job.agreedPrice);
            _sendEth(job.specialist, amount);
        }
    }

    // Called by KeeperHub (or anyone) after the dispute window expires
    function releasePayout(bytes32 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.status == JobStatus.DELIVERED, "JobEscrow: not in delivered state");
        require(block.timestamp > job.disputeWindowEnd, "JobEscrow: dispute window still open");

        uint256 amount = escrow[jobId];
        escrow[jobId] = 0;
        job.status = JobStatus.SETTLED;
        job.settledAt = block.timestamp;

        registry.updateReputation(job.specialist, true, job.agreedPrice);
        _trySettleParent(job.parentJobId);

        emit PayoutReleased(jobId, job.specialist, amount);
        _sendEth(job.specialist, amount);
    }

    // Anyone can call after deadline if specialist never submitted
    function markFailed(bytes32 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.status == JobStatus.ASSIGNED, "JobEscrow: job not assigned");
        require(block.timestamp > job.deadline, "JobEscrow: deadline not passed");

        uint256 amount = escrow[jobId];
        escrow[jobId] = 0;
        job.status = JobStatus.FAILED;
        job.settledAt = block.timestamp;

        registry.updateReputation(job.specialist, false, job.agreedPrice);

        emit JobFailed(jobId, job.specialist);
        _sendEth(job.planner, amount);
    }

    // Planner can cancel before any bid is accepted (no reputation change)
    function cancelJob(bytes32 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.planner == msg.sender, "JobEscrow: not planner");
        require(job.status == JobStatus.OPEN, "JobEscrow: can only cancel open jobs");

        uint256 amount = escrow[jobId];
        escrow[jobId] = 0;
        job.status = JobStatus.CANCELLED;

        emit JobCancelled(jobId);
        _sendEth(job.planner, amount);
    }

    // ── Views ────────────────────────────────────────────────────────────────

    function getJob(bytes32 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }

    function getBids(bytes32 jobId) external view returns (Bid[] memory) {
        return bids[jobId];
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    // Parent settles automatically when all children reach a terminal state.
    // Parent's own escrow was already spent funding child jobs; this just
    // marks the parent record closed for UI / event tracking.
    function _trySettleParent(bytes32 parentJobId) internal {
        if (parentJobId == bytes32(0)) return;
        Job storage parent = jobs[parentJobId];
        if (parent.status != JobStatus.ASSIGNED) return;

        for (uint256 i = 0; i < parent.childJobIds.length; i++) {
            JobStatus cs = jobs[parent.childJobIds[i]].status;
            if (cs != JobStatus.SETTLED && cs != JobStatus.CANCELLED && cs != JobStatus.FAILED) {
                return; // at least one child still live
            }
        }

        // All children terminal — mark parent settled (no ETH movement)
        parent.status = JobStatus.SETTLED;
        parent.settledAt = block.timestamp;
    }

    function _sendEth(address to, uint256 amount) internal {
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "JobEscrow: ETH transfer failed");
    }
}
