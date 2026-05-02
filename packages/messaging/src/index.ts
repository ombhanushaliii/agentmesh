import type {
  MessageEnvelope,
  MessageType,
  JobPostMessage,
  BidMessage,
  AcceptMessage,
  ResultMessage,
} from "@agentmesh/types";

export type { MessageEnvelope, MessageType, JobPostMessage, BidMessage, AcceptMessage, ResultMessage };

export interface AXLTopology {
  our_public_key: string;
  our_ipv6: string;
  peers: string[];
  tree: unknown;
}

export class AXLClient {
  private bridgeUrl: string;
  private _publicKey: string | null = null;
  private _poll: ReturnType<typeof setInterval> | null = null;

  constructor(bridgeUrl = "http://127.0.0.1:9002") {
    this.bridgeUrl = bridgeUrl.replace(/\/$/, "");
  }

  // ── Core send/recv ────────────────────────────────────────

  async send(envelope: MessageEnvelope): Promise<void> {
    const res = await fetch(`${this.bridgeUrl}/send`, {
      method: "POST",
      headers: {
        "X-Destination-Peer-Id": envelope.to,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(envelope),
    });
    if (!res.ok) {
      throw new Error(`AXL /send ${res.status}: ${await res.text()}`);
    }
  }

  // Returns null when the queue is empty (204/404) or the body is blank.
  async receive(): Promise<MessageEnvelope | null> {
    const res = await fetch(`${this.bridgeUrl}/recv`);
    if (res.status === 204 || res.status === 404 || res.status === 204) return null;
    if (!res.ok) throw new Error(`AXL /recv ${res.status}: ${await res.text()}`);

    const body = await res.text();
    if (!body.trim()) return null;

    const envelope = JSON.parse(body) as MessageEnvelope;
    // X-From-Peer-Id is authoritative — the sender field inside the envelope
    // could be spoofed, the transport header cannot.
    const from = res.headers.get("X-From-Peer-Id");
    if (from) envelope.from = from;
    return envelope;
  }

  // ── Subscription polling ──────────────────────────────────

  subscribe(
    handler: (msg: MessageEnvelope) => void | Promise<void>,
    intervalMs = 200
  ): void {
    if (this._poll) return;
    this._poll = setInterval(async () => {
      try {
        const msg = await this.receive();
        if (msg) await handler(msg);
      } catch {
        // absorb transient poll errors — caller re-subscribes if fatal
      }
    }, intervalMs);
  }

  unsubscribe(): void {
    if (this._poll) {
      clearInterval(this._poll);
      this._poll = null;
    }
  }

  // ── Node identity ─────────────────────────────────────────

  async topology(): Promise<AXLTopology> {
    const res = await fetch(`${this.bridgeUrl}/topology`);
    if (!res.ok) throw new Error(`AXL /topology ${res.status}`);
    return res.json() as Promise<AXLTopology>;
  }

  async publicKey(): Promise<string> {
    if (!this._publicKey) {
      const topo = await this.topology();
      this._publicKey = topo.our_public_key;
    }
    return this._publicKey;
  }
}

// ── Envelope helpers ───────────────────────────────────────

function envelope(
  type: MessageType,
  from: string,
  to: string,
  payload: MessageEnvelope["payload"]
): MessageEnvelope {
  return { type, from, to, payload, timestamp: Date.now() };
}

export function makeJobPost(
  from: string,
  to: string,
  payload: JobPostMessage
): MessageEnvelope {
  return envelope("JOB_POST", from, to, payload);
}

export function makeBid(
  from: string,
  to: string,
  payload: BidMessage
): MessageEnvelope {
  return envelope("BID", from, to, payload);
}

export function makeAccept(
  from: string,
  to: string,
  payload: AcceptMessage
): MessageEnvelope {
  return envelope("ACCEPT", from, to, payload);
}

export function makeResult(
  from: string,
  to: string,
  payload: ResultMessage
): MessageEnvelope {
  return envelope("RESULT", from, to, payload);
}
