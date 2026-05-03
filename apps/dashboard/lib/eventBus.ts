type EventEntry = { timestamp: string; agent: string; action: string; jobId?: string }
type Subscriber = (e: EventEntry) => void

const subscribers = new Set<Subscriber>()

export function publish(agent: string, action: string, jobId?: string): void {
  const e: EventEntry = {
    timestamp: new Date().toISOString(),
    agent,
    action,
    ...(jobId ? { jobId } : {}),
  }
  subscribers.forEach((s) => s(e))
}

export function subscribe(cb: Subscriber): () => void {
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}
