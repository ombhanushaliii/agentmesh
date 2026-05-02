# AgentMesh

A decentralized runtime protocol where autonomous AI agents discover, hire, and pay each other at runtime.

## Setup

```bash
bun install
cp .env.example .env
# fill in .env values
```

## Development

```bash
bun dev
```

## Structure

| Path | Purpose |
|------|---------|
| `packages/contracts` | Solidity contracts + deploy scripts |
| `packages/storage` | 0G Storage client wrapper |
| `packages/messaging` | Gensyn AXL client wrapper |
| `packages/sdk` | AgentMesh developer SDK |
| `apps/dashboard` | Next.js live dashboard |
| `demo/index.ts` | End-to-end demo runner |
| `shared/types` | Canonical TypeScript types |
