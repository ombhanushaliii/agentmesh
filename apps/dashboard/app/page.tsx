"use client"

import { useState, useEffect, useRef } from "react"
import { Input } from "../components/ui/input"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Badge } from "../components/ui/badge"
import { Separator } from "../components/ui/separator"
import { ScrollArea } from "../components/ui/scroll-area"
import { cn } from "../components/ui/utils"

// ── Types ──────────────────────────────────────────────────────────────────

type AgentProfile = {
  name: string
  status: "available" | "working" | "offline"
  capabilities: string[]
  reputation: number
}

type AgentEvent = {
  timestamp: string
  agent: string
  action: string
  jobId?: string
}

type Phase = "idle" | "decomposing" | "researching" | "synthesizing" | "done"

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTime(ts: string): string {
  try { return new Date(ts).toTimeString().slice(0, 8) } catch { return ts.slice(0, 8) }
}

function derivePhase(events: AgentEvent[], isRunning: boolean, hasResult: boolean): Phase {
  if (hasResult && !isRunning) return "done"
  if (!isRunning && events.length === 0) return "idle"
  const actions = events.map((e) => e.action.toLowerCase())
  if (actions.some((a) => a.includes("result_submitted") || a.includes("synthesiz"))) return "synthesizing"
  if (actions.some((a) => a.includes("bid_accepted") || a.includes("inference"))) return "researching"
  if (actions.some((a) => a.includes("job_posted") || a.includes("decompos"))) return "decomposing"
  if (isRunning) return "decomposing"
  return "idle"
}

function latestPerAgent(events: AgentEvent[]): Map<string, string> {
  const map = new Map<string, string>()
  for (let i = events.length - 1; i >= 0; i--) {
    map.set(events[i].agent, events[i].action)
  }
  return map
}

// ── Constants ──────────────────────────────────────────────────────────────

const PHASE_ORDER: Phase[] = ["idle", "decomposing", "researching", "synthesizing", "done"]

const STEPS = [
  {
    id: "decomposing" as Phase,
    label: "Decompose",
    desc: "Planner breaks the goal into parallel research tasks",
  },
  {
    id: "researching" as Phase,
    label: "Research",
    desc: "Specialist agents bid, get hired on-chain, and run inference",
  },
  {
    id: "synthesizing" as Phase,
    label: "Synthesize",
    desc: "Planner combines results and payment settles on-chain",
  },
]

const PHASE_LABELS: Record<Phase, string> = {
  idle: "",
  decomposing: "Decomposing goal…",
  researching: "Researching in parallel…",
  synthesizing: "Synthesizing answer…",
  done: "Complete",
}

const EXAMPLES = [
  "What are the top 3 risks of liquid staking in 2025?",
  "Summarize the most significant DeFi exploits this year",
  "Compare optimistic vs ZK rollup trade-offs for developers",
]

// ── Pipeline ───────────────────────────────────────────────────────────────

function Pipeline({ phase }: { phase: Phase }) {
  const current = PHASE_ORDER.indexOf(phase)
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground font-medium">
            Pipeline
          </CardTitle>
          {phase !== "idle" && phase !== "done" && (
            <Badge variant="outline" className="text-[10px]">
              <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-foreground animate-pulse inline-block" />
              live
            </Badge>
          )}
          {phase === "done" && (
            <Badge variant="secondary" className="text-[10px]">complete</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pb-5">
        <div className="space-y-0">
          {STEPS.map((step, i) => {
            const stepIdx = PHASE_ORDER.indexOf(step.id)
            const isDone   = current > stepIdx
            const isActive = current === stepIdx
            const isPending = current < stepIdx
            const isLast   = i === STEPS.length - 1

            return (
              <div key={step.id} className="flex gap-4">
                {/* Left: connector line + circle */}
                <div className="flex flex-col items-center">
                  <div className="relative">
                    {isActive && (
                      <span className="absolute inset-0 rounded-full border-2 border-foreground animate-ping opacity-25" />
                    )}
                    <div
                      className={cn(
                        "h-7 w-7 rounded-full border-2 flex items-center justify-center text-[11px] font-bold shrink-0 transition-all duration-300",
                        isDone   && "bg-foreground border-foreground text-background",
                        isActive && "border-foreground text-foreground",
                        isPending && "border-muted text-muted-foreground"
                      )}
                    >
                      {isDone ? "✓" : i + 1}
                    </div>
                  </div>
                  {!isLast && (
                    <div className={cn(
                      "w-px flex-1 my-1 min-h-[1.5rem] transition-colors duration-500",
                      isDone ? "bg-foreground" : "bg-border"
                    )} />
                  )}
                </div>

                {/* Right: content */}
                <div className={cn("pb-5 flex-1 min-w-0", isLast && "pb-0")}>
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className={cn(
                      "text-sm font-medium",
                      isPending && "text-muted-foreground"
                    )}>
                      {step.label}
                    </span>
                    <Badge
                      variant={isDone ? "default" : isActive ? "outline" : "secondary"}
                      className="text-[10px] shrink-0"
                    >
                      {isDone ? "done" : isActive ? "in progress" : "waiting"}
                    </Badge>
                  </div>
                  <p className={cn(
                    "text-xs leading-relaxed",
                    isPending ? "text-muted-foreground/60" : "text-muted-foreground"
                  )}>
                    {step.desc}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

// ── Agent Card ─────────────────────────────────────────────────────────────

function AgentCard({
  agent,
  latestAction,
  isRunning,
}: {
  agent: AgentProfile
  latestAction?: string
  isRunning: boolean
}) {
  const isWorking = isRunning && !!latestAction

  return (
    <div className={cn(
      "rounded-lg border p-4 space-y-3 transition-all duration-200",
      isWorking && "border-foreground/30 bg-muted/20"
    )}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium truncate">{agent.name}</span>
        <Badge variant={isWorking ? "default" : "outline"} className="shrink-0 text-[10px]">
          {isWorking ? (
            <>
              <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-background inline-block animate-pulse" />
              working
            </>
          ) : agent.status}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-1">
        {agent.capabilities.map((cap) => (
          <Badge key={cap} variant="secondary" className="text-[10px]">{cap}</Badge>
        ))}
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Reputation</span>
        <span className="font-medium tabular-nums">{agent.reputation} / 100</span>
      </div>

      {isWorking && latestAction && (
        <div className="pt-2 border-t">
          <p className="text-[11px] text-muted-foreground truncate">{latestAction}</p>
        </div>
      )}
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function HomePage() {
  const [goal, setGoal] = useState("")
  const [isRunning, setIsRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [agents, setAgents] = useState<AgentProfile[]>([])
  const [copied, setCopied] = useState(false)
  const [lastJobId, setLastJobId] = useState<string | null>(null)
  const [disputeState, setDisputeState] = useState<"idle" | "pending" | "ok" | "error">("idle")
  const [disputeError, setDisputeError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const phase = derivePhase(events, isRunning, result !== null)
  const agentActions = latestPerAgent(events)
  const showPipeline = phase !== "idle"

  useEffect(() => {
    fetchAgents()
    return setupEventStream()
  }, [])

  async function fetchAgents() {
    try {
      const res = await fetch("/api/agents")
      const data = await res.json()
      setAgents(Array.isArray(data) ? data : [])
    } catch {}
  }

  function setupEventStream() {
    const es = new EventSource("/api/events")
    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as AgentEvent
      setEvents((prev) => [data, ...prev].slice(0, 100))
      if (data.jobId) setLastJobId(data.jobId)
    }
    return () => es.close()
  }

  async function runGoal() {
    if (!goal.trim() || isRunning) return
    setIsRunning(true)
    setResult(null)
    setEvents([])
    setLastJobId(null)
    setDisputeState("idle")
    setDisputeError(null)

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal }),
      })
      if (!res.body) return
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      const chunks: string[] = []

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          const t = line.trim()
          if (t && !t.startsWith("data:")) chunks.push(t)
        }
      }
      const tail = (buffer + decoder.decode()).trim()
      if (tail && !tail.startsWith("data:")) chunks.push(tail)
      if (chunks.length > 0) setResult(chunks.join("\n"))
    } catch (e) {
      console.error("Run failed", e)
    } finally {
      setIsRunning(false)
    }
  }

  async function raiseDispute() {
    if (!lastJobId || disputeState !== "idle") return
    setDisputeState("pending")
    try {
      const res = await fetch("/api/dispute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: lastJobId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setDisputeError(data.error ?? "dispute failed")
        setDisputeState("error")
      } else {
        setDisputeState("ok")
      }
    } catch {
      setDisputeError("network error")
      setDisputeState("error")
    }
  }

  function copyResult() {
    if (!result) return
    navigator.clipboard.writeText(result)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  function useExample(text: string) {
    setGoal(text)
    inputRef.current?.focus()
  }

  return (
    <div className="min-h-[calc(100vh-3.25rem)] p-6 max-w-6xl mx-auto flex flex-col gap-6">

      {/* ── Command bar ─────────────────────────────────────────────────── */}
      <div className="space-y-3 pt-2">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            placeholder="What should the agents research?"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runGoal()}
            disabled={isRunning}
            className="h-11 text-sm"
            suppressHydrationWarning
          />
          <Button
            onClick={runGoal}
            disabled={isRunning || !goal.trim()}
            className="h-11 px-5 shrink-0 font-medium"
            suppressHydrationWarning
          >
            {isRunning ? (
              <span className="flex items-center gap-2">
                <span className="inline-block animate-spin">↻</span>
                Running
              </span>
            ) : "Run →"}
          </Button>
        </div>

        {/* Status line */}
        <div className="h-5 flex items-center gap-3">
          {isRunning && phase !== "idle" && (
            <span className="text-xs text-muted-foreground animate-pulse">
              {PHASE_LABELS[phase]}
            </span>
          )}
          {phase === "done" && !isRunning && (
            <span className="text-xs text-muted-foreground">
              Done — {events.length} events recorded
            </span>
          )}
        </div>
      </div>

      {/* ── Two-column body ──────────────────────────────────────────────── */}
      <div className="flex flex-col md:grid md:grid-cols-5 gap-6 flex-1">

        {/* Left (3/5) — pipeline + result + empty state */}
        <div className="md:col-span-3 flex flex-col gap-5">

          {showPipeline && <Pipeline phase={phase} />}

          {result && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground font-medium">
                    Answer
                  </CardTitle>
                  <div className="flex items-center gap-1.5">
                    {disputeState === "idle" && lastJobId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={raiseDispute}
                        className="h-7 px-2.5 text-xs text-muted-foreground/60 hover:text-destructive"
                      >
                        Dispute
                      </Button>
                    )}
                    {disputeState === "pending" && (
                      <span className="text-xs text-muted-foreground animate-pulse">Raising dispute…</span>
                    )}
                    {disputeState === "ok" && (
                      <span className="text-xs text-muted-foreground">Dispute raised ✓</span>
                    )}
                    {disputeState === "error" && (
                      <span className="text-xs text-destructive/70 max-w-[160px] truncate" title={disputeError ?? ""}>
                        {disputeError}
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={copyResult}
                      className="h-7 px-2.5 text-xs"
                    >
                      {copied ? "Copied ✓" : "Copy"}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-7 whitespace-pre-wrap">{result}</p>
              </CardContent>
            </Card>
          )}

          {!showPipeline && !result && (
            <div className="flex-1 rounded-lg border border-dashed flex flex-col items-center justify-center gap-6 py-12 px-8 text-center">
              <div className="space-y-1.5 max-w-xs">
                <p className="text-sm font-medium">No agents running</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Type a goal above and click Run. Agents will discover each other on-chain,
                  bid for tasks, run inference, and settle payment automatically.
                </p>
              </div>
              <div className="w-full max-w-xs space-y-2">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Try an example</p>
                <div className="flex flex-col gap-1.5">
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      onClick={() => useExample(ex)}
                      className="text-left text-xs px-3 py-2.5 rounded-md border hover:border-foreground/30 hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right (2/5) — agents + activity */}
        <div className="md:col-span-2 flex flex-col gap-5">

          {/* Agents */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-widest text-muted-foreground font-medium">
                Agents
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {agents.length} registered
              </span>
            </div>

            {agents.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-6 text-center">
                <p className="text-xs text-muted-foreground">No agents registered on-chain.</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Run <code className="font-mono bg-muted px-1 py-px rounded text-[10px]">bun run scripts/run-researcher.ts</code>
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {agents.map((agent) => (
                  <AgentCard
                    key={agent.name}
                    agent={agent}
                    latestAction={agentActions.get(agent.name)}
                    isRunning={isRunning}
                  />
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Activity feed */}
          <div className="space-y-3 flex-1">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-widest text-muted-foreground font-medium">
                Activity
              </span>
              {events.length > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {events.length}
                </span>
              )}
            </div>

            <ScrollArea className="h-64 rounded-lg border bg-muted/20">
              {events.length === 0 ? (
                <div className="h-64 flex items-center justify-center">
                  <p className="text-xs text-muted-foreground">Waiting for activity…</p>
                </div>
              ) : (
                <div className="p-3 space-y-0.5 font-mono text-[11px]">
                  {events.map((ev, i) => (
                    <div key={i} className="flex gap-2 py-0.5 items-baseline min-w-0">
                      <span className="text-muted-foreground/60 shrink-0 tabular-nums">
                        {formatTime(ev.timestamp)}
                      </span>
                      <span className="text-muted-foreground shrink-0 font-sans font-medium text-[10px]">
                        {ev.agent}
                      </span>
                      <span className="text-muted-foreground truncate">{ev.action}</span>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

        </div>
      </div>
    </div>
  )
}
