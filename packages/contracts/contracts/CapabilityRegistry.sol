// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract CapabilityRegistry {
    address public owner;
    address public jobEscrow;

    struct ReputationRecord {
        uint256 score;            // 0–100
        uint256 totalJobs;
        uint256 successfulJobs;
        uint256 weightedSuccesses; // wei-denominated sum of successful job values
        uint256 weightedTotal;     // wei-denominated sum of all settled job values
    }

    struct AgentProfile {
        address agentAddress;
        string name;
        string[] capabilities;
        uint256 pricePerJob;
        string endpoint;
        bool available;
        uint256 registeredAt;
        ReputationRecord reputation;
    }

    address[] public agentList;
    mapping(address => AgentProfile) private profiles;
    mapping(address => bool) private registered;

    event AgentRegistered(address indexed agent, string name, string[] capabilities);
    event ReputationUpdated(address indexed agent, uint256 newScore, bool success, uint256 jobValue);

    modifier onlyJobEscrow() {
        require(msg.sender == jobEscrow, "CapabilityRegistry: caller is not JobEscrow");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setJobEscrow(address _jobEscrow) external {
        require(msg.sender == owner, "CapabilityRegistry: not owner");
        require(_jobEscrow != address(0), "CapabilityRegistry: zero address");
        jobEscrow = _jobEscrow;
    }

    function register(
        string calldata name,
        string[] calldata capabilities,
        uint256 pricePerJob,
        string calldata endpoint
    ) external {
        AgentProfile storage p = profiles[msg.sender];

        if (!registered[msg.sender]) {
            registered[msg.sender] = true;
            agentList.push(msg.sender);
            p.registeredAt = block.timestamp;
        }

        p.agentAddress = msg.sender;
        p.name = name;
        p.capabilities = capabilities;
        p.pricePerJob = pricePerJob;
        p.endpoint = endpoint;
        p.available = true;

        emit AgentRegistered(msg.sender, name, capabilities);
    }

    function setAvailable(bool available) external {
        require(registered[msg.sender], "CapabilityRegistry: not registered");
        profiles[msg.sender].available = available;
    }

    // O(agents × capabilities) — acceptable at hackathon scale
    function lookup(string calldata capability) external view returns (AgentProfile[] memory) {
        bytes32 capHash = keccak256(bytes(capability));

        uint256 count = 0;
        for (uint256 i = 0; i < agentList.length; i++) {
            AgentProfile storage p = profiles[agentList[i]];
            if (p.available && _hasCapability(p.capabilities, capHash)) count++;
        }

        AgentProfile[] memory result = new AgentProfile[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < agentList.length; i++) {
            AgentProfile storage p = profiles[agentList[i]];
            if (p.available && _hasCapability(p.capabilities, capHash)) {
                result[idx++] = p;
            }
        }
        return result;
    }

    function getProfile(address agent) external view returns (AgentProfile memory) {
        return profiles[agent];
    }

    // score = (weightedSuccesses * 100) / weightedTotal
    function updateReputation(address agent, bool success, uint256 jobValue) external onlyJobEscrow {
        require(registered[agent], "CapabilityRegistry: agent not registered");

        ReputationRecord storage rep = profiles[agent].reputation;
        rep.totalJobs++;
        rep.weightedTotal += jobValue;

        if (success) {
            rep.successfulJobs++;
            rep.weightedSuccesses += jobValue;
        }

        rep.score = (rep.weightedSuccesses * 100) / rep.weightedTotal;

        emit ReputationUpdated(agent, rep.score, success, jobValue);
    }

    function _hasCapability(
        string[] storage caps,
        bytes32 capHash
    ) private view returns (bool) {
        for (uint256 i = 0; i < caps.length; i++) {
            if (keccak256(bytes(caps[i])) == capHash) return true;
        }
        return false;
    }
}
