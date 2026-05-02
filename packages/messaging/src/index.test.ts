import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import {
  AXLClient,
  makeJobPost,
  makeBid,
  makeAccept,
  makeResult,
} from "./index";
import type { MessageEnvelope } from "@agentmesh/types";

// Mock fetch globally so tests run without a real AXL node.
const mockFetch = mock(async (url: string, init?: RequestInit): Promise<Response> => {
  const u = url.toString();

  if (u.endsWith("/topology")) {
    return new Response(JSON.stringify({
      our_public_key: "aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222",
      our_ipv6: "200::",
      peers: [],
      tree: {},
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  if (u.endsWith("/send")) {
    return new Response("", { status: 200 });
  }

  if (u.endsWith("/recv")) {
    // Return the queued message once, then empty
    const body = (mockFetch as any).__queue?.shift();
    if (!body) return new Response("", { status: 204 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-From-Peer-Id": body.from,
      },
    });
  }

  return new Response("not found", { status: 404 });
});

(globalThis as any).fetch = mockFetch;

const PUB_A = "aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222";
const PUB_B = "bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222cccc3333";

describe("AXLClient", () => {
  let client: AXLClient;

  beforeEach(() => {
    client = new AXLClient("http://127.0.0.1:9002");
    (mockFetch as any).__queue = [];
    mockFetch.mockClear();
  });

  afterEach(() => {
    client.unsubscribe();
  });

  it("publicKey() fetches topology", async () => {
    const key = await client.publicKey();
    expect(key).toBe(PUB_A);
  });

  it("publicKey() caches after first call", async () => {
    await client.publicKey();
    await client.publicKey();
    // mockFetch called only once for topology
    const topologyCalls = (mockFetch.mock.calls as string[][]).filter(
      ([url]) => url.endsWith("/topology")
    );
    expect(topologyCalls.length).toBe(1);
  });

  it("send() posts to /send with X-Destination-Peer-Id header", async () => {
    const envelope = makeJobPost(PUB_A, PUB_B, {
      jobId: "job-1",
      description: "research DeFi",
      requiredCapability: "research",
      maxBudget: "1000000000000000000",
      deadline: Date.now() + 60_000,
      plannerEndpoint: PUB_A,
    });
    await client.send(envelope);

    const sendCalls = (mockFetch.mock.calls as Array<[string, RequestInit]>).filter(
      ([url]) => url.endsWith("/send")
    );
    expect(sendCalls.length).toBeGreaterThan(0);
    const [, init] = sendCalls[sendCalls.length - 1];
    expect((init?.headers as Record<string, string>)["X-Destination-Peer-Id"]).toBe(PUB_B);
  });

  it("receive() returns null when queue is empty", async () => {
    const msg = await client.receive();
    expect(msg).toBeNull();
  });

  it("receive() decodes envelope and trusts X-From-Peer-Id header", async () => {
    const envelope = makeBid(PUB_B, PUB_A, {
      jobId: "job-1",
      specialistAddress: PUB_B,
      specialistEndpoint: PUB_B,
      bidPrice: "500000000000000000",
    });
    (mockFetch as any).__queue = [envelope];
    const msg = await client.receive();
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("BID");
    expect(msg!.from).toBe(PUB_B);
  });

  it("subscribe() calls handler on incoming message", async () => {
    const received: MessageEnvelope[] = [];
    const envelope = makeResult(PUB_B, PUB_A, {
      jobId: "job-1",
      resultHash: "0xdeadbeef",
      resultUrl: "axl://result",
    });
    (mockFetch as any).__queue = [envelope];

    await new Promise<void>((resolve) => {
      client.subscribe((msg) => {
        received.push(msg);
        resolve();
      }, 50);
    });

    expect(received.length).toBe(1);
    expect(received[0].type).toBe("RESULT");
  });
});

describe("envelope helpers", () => {
  it("makeJobPost sets type=JOB_POST and timestamp", () => {
    const msg = makeJobPost(PUB_A, PUB_B, {
      jobId: "j1", description: "d", requiredCapability: "cap",
      maxBudget: "100", deadline: 1, plannerEndpoint: PUB_A,
    });
    expect(msg.type).toBe("JOB_POST");
    expect(msg.from).toBe(PUB_A);
    expect(msg.to).toBe(PUB_B);
    expect(msg.timestamp).toBeGreaterThan(0);
  });

  it("makeBid sets type=BID", () => {
    const msg = makeBid(PUB_B, PUB_A, {
      jobId: "j1", specialistAddress: PUB_B, specialistEndpoint: PUB_B, bidPrice: "50",
    });
    expect(msg.type).toBe("BID");
  });

  it("makeAccept sets type=ACCEPT", () => {
    const msg = makeAccept(PUB_A, PUB_B, {
      jobId: "j1", specialistAddress: PUB_B, agreedPrice: "50",
    });
    expect(msg.type).toBe("ACCEPT");
  });

  it("makeResult sets type=RESULT", () => {
    const msg = makeResult(PUB_B, PUB_A, {
      jobId: "j1", resultHash: "0xabc", resultUrl: "axl://r",
    });
    expect(msg.type).toBe("RESULT");
  });
});
