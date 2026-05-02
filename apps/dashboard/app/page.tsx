"use client"

import { useState, useEffect } from "react"
import { Input } from "../components/ui/input"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"

type AgentProfile = {
  name: string
  status: "available" | "working" | "offline"
  capabilities: string[]
  reputation: number
  currentJob?: string
}

type AgentEvent = {
  timestamp: string
  agent: string
  action: string
}

function formatTime(ts: string): string {
  try {
    return new Date(ts).toTimeString().slice(0, 8)
  } catch {
    return ts.slice(0, 8)
  }
}

export default function HomePage() {
  const [goal, setGoal] = useState("")
  const [isRunning, setIsRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [agents, setAgents] = useState<AgentProfile[]>([])

  useEffect(() => {
    fetchAgents()
    return setupEventStream()
  }, [])

  async function fetchAgents() {
    try {
      const res = await fetch("/api/agents")
      const data = await res.json()
      setAgents(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error("Failed to fetch agents", e)
    }
  }

  function setupEventStream() {
    const eventSource = new EventSource("/api/events")
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data)
      setEvents((prev) => [data, ...prev].slice(0, 50))
    }
    return () => eventSource.close()
  }

  async function runGoal() {
    if (!goal || isRunning) return
    setIsRunning(true)
    setResult(null)
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
      const resultChunks: string[] = []

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith("data:")) continue
          resultChunks.push(trimmed)
        }
      }

      const remainder = (buffer + decoder.decode()).trim()
      if (remainder && !remainder.startsWith("data:")) {
        resultChunks.push(remainder)
      }

      if (resultChunks.length > 0) {
        setResult(resultChunks.join("\n"))
      }
    } catch (e) {
      console.error("Run goal failed", e)
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">

      {/* Agents */}
      {agents.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {agents.map((agent) => (
            <Card key={agent.name}>
              <CardHeader>
                <CardTitle>{agent.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Status</div>
                  <div className="text-sm font-medium capitalize">{agent.status}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Capabilities</div>
                  <div className="text-sm">{agent.capabilities.join(", ")}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Reputation</div>
                  <div className="text-sm font-medium">{agent.reputation} reputation</div>
                </div>
                {agent.status === "working" && agent.currentJob && (
                  <div className="pt-3 border-t">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Current Job</div>
                    <div className="text-xs text-muted-foreground truncate">{agent.currentJob}</div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border px-6 py-12 text-center text-sm text-muted-foreground">
          No agents registered.
        </div>
      )}

      {/* Goal input */}
      <div className="space-y-3">
        <Input
          placeholder="e.g. Research the top risks of liquid staking"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runGoal()}
          className="h-10 text-sm"
        />
        <div className="flex justify-end">
          <Button onClick={runGoal} disabled={isRunning || !goal}>
            {isRunning ? "Running..." : "Run"}
          </Button>
        </div>
      </div>

      {/* Activity feed */}
      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Activity</div>
        <div className="rounded-xl border bg-muted/30 px-4 py-3 h-[300px] overflow-y-auto font-mono text-xs">
          {events.length === 0 ? (
            <span className="text-muted-foreground italic">No activity yet.</span>
          ) : (
            <div className="space-y-1">
              {events.map((event, i) => (
                <div key={i} className="whitespace-nowrap">
                  <span className="text-muted-foreground">{formatTime(event.timestamp)}</span>
                  {"  "}
                  <span className="font-semibold">{event.agent}</span>
                  {"  "}
                  <span>{event.action}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

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
