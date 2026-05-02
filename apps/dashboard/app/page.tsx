"use client"

import { useState, useEffect } from "react"
import { Input } from "../components/ui/input"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Copy } from "lucide-react"

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
      setAgents(data)
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
    if (!goal) return
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

  const copyResult = () => {
    if (result) navigator.clipboard.writeText(result)
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {agents.map((agent) => (
          <Card key={agent.name}>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-lg font-bold">{agent.name}</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <span>{agent.status}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Capabilities</span>
                <span className="text-right">{agent.capabilities.join(", ")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Reputation</span>
                <span>{agent.reputation} reputation</span>
              </div>
              {agent.status === "working" && agent.currentJob && (
                <div className="mt-2 pt-2 border-t text-xs text-muted-foreground truncate">
                  Job: {agent.currentJob}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-4">
        <div className="flex flex-col gap-4">
          <Input
            placeholder="e.g. Research the top risks of liquid staking"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className="text-lg"
          />
          <div className="flex justify-end">
            <Button onClick={runGoal} disabled={isRunning}>
              {isRunning ? "Running..." : "Run"}
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium text-muted-foreground">Activity Feed</div>
        <div className="bg-muted/30 border rounded-md p-3 h-[300px] overflow-y-auto font-mono text-xs space-y-1">
          {events.length === 0 ? (
            <div className="text-muted-foreground italic">No activity yet.</div>
          ) : (
            events.map((event, i) => (
              <div key={i} className="whitespace-nowrap">
                <span className="text-muted-foreground mr-2">{event.timestamp}</span>
                <span className="font-bold mr-2">{event.agent}</span>
                <span>{event.action}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {result && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4">
            <CardTitle className="text-sm font-medium">Synthesized Result</CardTitle>
            <Button variant="outline" size="sm" onClick={copyResult} className="h-8 px-2">
              <Copy className="h-3 w-3 mr-1" />
              Copy
            </Button>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-sm leading-relaxed">
            {result}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
