"use client"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { ExternalLink } from "lucide-react"

type JobRecord = {
  id: string
  capability: string
  status: string
  amount: string
  settledAt: string
  txHash: string
}

export default function ExplorerPage() {
  // Mock data - will wire to real API later
  const jobs: JobRecord[] = []

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Job Explorer</h1>
        <p className="text-muted-foreground text-sm">View all on-chain agent jobs and settlements.</p>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">Job ID</TableHead>
              <TableHead>Capability</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Amount (ETH)</TableHead>
              <TableHead className="text-right">Settled At</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-10 text-muted-foreground italic">
                  No jobs yet.
                </TableCell>
              </TableRow>
            ) : (
              jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="font-mono text-xs">{job.id}</TableCell>
                  <TableCell>{job.capability}</TableCell>
                  <TableCell>{job.status}</TableCell>
                  <TableCell>{job.amount}</TableCell>
                  <TableCell className="text-right">
                    <a
                      href={`https://explorer.0g.ai/tx/${job.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline inline-flex items-center gap-1 text-xs"
                    >
                      View <ExternalLink className="h-3 w-3" />
                    </a>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
