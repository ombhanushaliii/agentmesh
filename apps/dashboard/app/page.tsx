"use client"

import { useState, useEffect, useRef } from "react"
import { Input } from "../components/ui/input"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { cn } from "../components/ui/utils"

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
}

type Phase = "idle" | "decomposing" | "researching" | "synthesizing" | "done"

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

const STEPS: { id: Phase; label: string; desc: string }[] = [
  { id: "decomposing", label: "Decompose",  desc: "Planner splits the goal into sub-tasks" },
  { id: "researching", label: "Research",   desc: "Specialists execute tasks in parallel" },
  { id: "synthesizing", label: "Synthesize", desc: "Planner combines results into an answer" },
]

const PHASE_ORDER: Phase[] = ["idle", "decomposing", "researching", "synthesizing", "done"]

function Pipeline({ phase }: { phase: Phase }) {
  const current = PHASE_ORDER.indexOf(phase)
  return (
    <div className="rounded-xl border px-6 py-5">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-4">Pipeline</div>
      <div className="flex items-start">
        {STEPS.map((step, i) => {
          const stepCurrent = PHASE_ORDER.indexOf(step.id)
          const isDone    = current > stepCurrent
          const isActive  = current === stepCurrent
          const isPending = current < stepCurrent
          return (
            <div key={step.id} className="flex items-start flex-1 min-w-0">
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "h-5 w-5 rounded-full border-2 flex items-center justify-center text-[10px] font-bold shrink-0 transition-colors",
                    isDone    && "bg-foreground border-foreground text-background",
                    isActive  && "border-foreground text-foreground",
                    isPending && "border-muted text-muted-foreground"
                  )}>
                    {isDone ? "✓" : i + 1}
                  </div>
                  <span className={cn(
                    "text-xs font-medium truncate",
                    isPending && "text-muted-foreground"
                  )}>
                    {step.label}
                  </span>
                  {isActive && (
                    <span className="text-[10px] text-muted-foreground animate-pulse shrink-0">
                      in progress
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground pl-7 leading-relaxed">{step.desc}</p>
              </div>
              {i < STEPS.length - 1 && (
                <div className={cn(
                  "h-px w-6 mt-2.5 mx-3 shrink-0 transition-colors",
                  isDone ? "bg-foreground" : "bg-border"
                )} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function HomePage() {
  const [goal, setGoal] = useState("")
  const [isRunning, setIsRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [agents, setAgents] = useState<AgentProfile[]>([])
  const feedRef = useRef<HTMLDivElement>(null)

  const phase = derivePhase(events, isRunning, result !== null)
  const agentActions = latestPerAgent(events)
  const showPipeline = isRunning || (phase !== "idle")

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
    }
    return () => es.close()
  }

  async function runGoal() {
    if (!goal.trim() || isRunning) return
    setIsRunning(true)
    setResult(null)
    setEvents([])

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

  return (
    <div className="min-h-screen p-6 max-w-4xl mx-auto space-y-6">

      {/* Header */}
      <div className="space-y-0.5 pb-2 border-b">
        <h1 className="font-semibold">AgentMesh</h1>
        <p className="text-sm text-muted-foreground">
          Autonomous AI agents discover, hire, and pay each other on-chain to complete your goal.
        </p>
      </div>

      {/* Goal input — primary action */}
      <div className="flex gap-2">
        <Input
          placeholder="What should the agents research? e.g. Top risks of liquid staking"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runGoal()}
          disabled={isRunning}
          className="h-10"
          suppressHydrationWarning
        />
        <Button
          onClick={runGoal}
          disabled={isRunning || !goal.trim()}
          className="shrink-0 px-6"
          suppressHydrationWarning
        >
          {isRunning ? "Running…" : "Run"}
        </Button>
      </div>

      {/* Pipeline — visible once a run starts */}
      {showPipeline && <Pipeline phase={phase} />}

      {/* Registered agents */}
      <div className="space-y-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Registered Agents
        </div>

        {agents.length === 0 ? (
          <div className="rounded-xl border px-6 py-8 text-center text-sm text-muted-foreground">
            No agents registered on-chain yet. Run the researcher script to register one.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {agents.map((agent) => {
              const latest = agentActions.get(agent.name)
              const isWorking = isRunning && !!latest
              return (
                <div
                  key={agent.name}
                  className={cn(
                    "rounded-xl border px-5 py-4 space-y-3 transition-all duration-200",
                    isWorking && "border-foreground shadow-sm"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{agent.name}</span>
                    <span className={cn(
                      "text-[10px] uppercase tracking-widest font-medium",
                      isWorking ? "text-foreground" : "text-muted-foreground"
                    )}>
                      {isWorking ? "● working" : agent.status}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      Capabilities
                    </div>
                    <div className="text-xs">{agent.capabilities.join(", ")}</div>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Reputation</span>
                    <span className="font-medium tabular-nums">{agent.reputation}</span>
                  </div>

                  {latest && isRunning && (
                    <div className="pt-2 border-t">
                      <p className="text-[11px] text-muted-foreground truncate">{latest}</p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Activity feed — only when there's something to show */}
      {events.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Activity
          </div>
          <div
            ref={feedRef}
            className="rounded-xl border bg-muted/30 px-4 py-3 h-44 overflow-y-auto font-mono text-xs space-y-1"
          >
            {events.map((ev, i) => (
              <div key={i} className="flex gap-3">
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {formatTime(ev.timestamp)}
                </span>
                <span className="font-semibold shrink-0">{ev.agent}</span>
                <span className="text-muted-foreground truncate">{ev.action}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Result</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{result}</p>
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigator.clipboard.writeText(result)}
              >
                Copy
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  )
}
