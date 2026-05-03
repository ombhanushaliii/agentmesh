import { Indexer, ZgFile, KvClient, Batcher, getFlowContract } from "@0gfoundation/0g-ts-sdk";
import { ethers } from "ethers";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const FLOW_CONTRACT_TESTNET = "0x22E03a6A89B950F1c82ec5e74F8eCa321a105296";

export interface StorageConfig {
  rpcUrl: string;
  indexerUrl: string;
  kvRpcUrl: string;
  privateKey: string;
  flowContract?: string;
}

export class StorageClient {
  private wallet: ethers.Wallet;
  private indexer: Indexer;
  private kv: KvClient;
  private config: StorageConfig;

  constructor(config: StorageConfig) {
    this.config = config;
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, provider);
    this.indexer = new Indexer(config.indexerUrl);
    this.kv = new KvClient(config.kvRpcUrl);
  }

  private flowContract() {
    return getFlowContract(
      this.config.flowContract ?? FLOW_CONTRACT_TESTNET,
      this.wallet
    );
  }

  private async selectNodes() {
    const [nodes, err] = await this.indexer.selectNodes(1);
    if (err) throw new Error(`selectNodes: ${err.message}`);
    return nodes;
  }

  // ── KV layer — real-time agent state ─────────────────────

  async kvSet(streamId: string, key: string, value: Uint8Array): Promise<string> {
    const nodes = await this.selectNodes();
    const batcher = new Batcher(1, nodes, this.flowContract(), this.config.rpcUrl);
    batcher.streamDataBuilder.set(streamId, Buffer.from(key), value);

    const [result, err] = await batcher.exec();
    if (err) throw new Error(`kvSet: ${err.message}`);
    return result.txHash;
  }

  async kvGet(streamId: string, key: string): Promise<Uint8Array | null> {
    const value = await this.kv.getValue(streamId, Buffer.from(key));
    if (!value) return null;
    return Buffer.from(value.data, "base64");
  }

  async kvDelete(streamId: string, key: string): Promise<string> {
    return this.kvSet(streamId, key, new Uint8Array(0));
  }

  async kvSetJSON<T>(streamId: string, key: string, data: T): Promise<string> {
    return this.kvSet(streamId, key, Buffer.from(JSON.stringify(data)));
  }

  async kvGetJSON<T>(streamId: string, key: string): Promise<T | null> {
    const bytes = await this.kvGet(streamId, key);
    if (!bytes || bytes.length === 0) return null;
    return JSON.parse(Buffer.from(bytes).toString()) as T;
  }

  // ── Log layer — history / audit trail ────────────────────
  // Stored as KV: `entry:<n>` → bytes, `__count` → 4-byte big-endian uint32

  async logAppend(streamId: string, entry: Uint8Array): Promise<string> {
    const countBytes = await this.kvGet(streamId, "__count");
    const count = countBytes && countBytes.length >= 4
      ? Buffer.from(countBytes).readUInt32BE(0)
      : 0;

    const nodes = await this.selectNodes();
    const batcher = new Batcher(1, nodes, this.flowContract(), this.config.rpcUrl);

    batcher.streamDataBuilder.set(streamId, Buffer.from(`entry:${count}`), entry);

    const nextCount = Buffer.alloc(4);
    nextCount.writeUInt32BE(count + 1, 0);
    batcher.streamDataBuilder.set(streamId, Buffer.from("__count"), nextCount);

    const [result, err] = await batcher.exec();
    if (err) throw new Error(`logAppend: ${err.message}`);
    return result.txHash;
  }

  async logAppendJSON<T>(streamId: string, data: T): Promise<string> {
    return this.logAppend(streamId, Buffer.from(JSON.stringify(data)));
  }

  async logRead(streamId: string, start: number, limit: number): Promise<Uint8Array[]> {
    const entries: Uint8Array[] = [];
    for (let i = start; i < start + limit; i++) {
      const bytes = await this.kvGet(streamId, `entry:${i}`);
      if (!bytes) break;
      entries.push(bytes);
    }
    return entries;
  }

  async logReadJSON<T>(streamId: string, start: number, limit: number): Promise<T[]> {
    const raw = await this.logRead(streamId, start, limit);
    return raw.map((b) => JSON.parse(Buffer.from(b).toString()) as T);
  }

  // ── File layer — result content / large blobs ─────────────

  async fileUpload(data: Uint8Array): Promise<string> {
    const tmpPath = path.join(
      os.tmpdir(),
      `agentmesh-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    fs.writeFileSync(tmpPath, data);

    const file = await ZgFile.fromFilePath(tmpPath);
    try {
      const [tree, treeErr] = await file.merkleTree();
      if (treeErr) throw new Error(`merkleTree: ${treeErr}`);

      const rootHash = tree!.rootHash() as string;
      const [, uploadErr] = await this.indexer.upload(file, this.config.rpcUrl, this.wallet);
      if (uploadErr) throw new Error(`upload: ${uploadErr.message}`);

      return rootHash;
    } finally {
      await file.close();
      fs.unlinkSync(tmpPath);
    }
  }

  async fileDownload(rootHash: string): Promise<Uint8Array> {
    const tmpPath = path.join(
      os.tmpdir(),
      `agentmesh-dl-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    try {
      const err = await this.indexer.download(rootHash, tmpPath, true);
      if (err) throw err;
      return new Uint8Array(fs.readFileSync(tmpPath));
    } catch (e: any) {
      throw new Error(`fileDownload: ${e.message}`);
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  }
}

export function createStorageClient(overrides?: Partial<StorageConfig>): StorageClient {
  return new StorageClient({
    rpcUrl:       overrides?.rpcUrl       ?? process.env.RPC_URL           ?? "https://evmrpc-testnet.0g.ai",
    indexerUrl:   overrides?.indexerUrl   ?? process.env.STORAGE_INDEXER   ?? "https://indexer-storage-testnet-turbo.0g.ai",
    kvRpcUrl:     overrides?.kvRpcUrl     ?? process.env.KV_RPC_URL        ?? "https://storagerpc-testnet.0g.ai",
    privateKey:   overrides?.privateKey   ?? process.env.PRIVATE_KEY       ?? "",
    flowContract: overrides?.flowContract ?? process.env.FLOW_CONTRACT,
  });
}
