import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true },
  },
  networks: {
    "0g-testnet": {
      url: process.env.RPC_URL ?? "https://evmrpc-testnet.0g.ai",
      chainId: 16602,
      accounts: process.env.PLANNER_PRIVATE_KEY
        ? [process.env.PLANNER_PRIVATE_KEY]
        : [],
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
