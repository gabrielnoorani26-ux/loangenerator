"use client";
import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { apiGet } from "@/lib/client/api";
import type { BatchDTO } from "@/lib/batches";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Row {
  id: string;
  action: string;
  details: string | null;
  createdAt: string;
  batch: { id: string; name: string } | null;
}

export default function ActivityPage() {
  const [batchId, setBatchId] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page), pageSize: "50" });
  if (batchId !== "all") params.set("batchId", batchId);
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  const { data, isLoading } = useQuery({
    queryKey: ["activity", params.toString()],
    queryFn: () => apiGet<{ rows: Row[]; total: number; pages: number; page: number }>(`/api/activity?${params}`),
    placeholderData: keepPreviousData,
  });
  const { data: batches } = useQuery({
    queryKey: ["batches", "all-for-filter"],
    queryFn: async () => (await apiGet<{ batches: BatchDTO[] }>("/api/batches?sort=newest")).batches,
  });

  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Activity</h1>
        <p className="text-sm text-muted-foreground">Everything that happened to your batches.</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label>Batch</Label>
          <Select value={batchId} onValueChange={(v) => reset(() => setBatchId(v))}>
            <SelectTrigger className="w-64" aria-label="Filter by batch">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All batches</SelectItem>
              {batches?.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="from">From</Label>
          <Input
            id="from"
            type="date"
            value={from}
            onChange={(e) => reset(() => setFrom(e.target.value))}
            className="w-40"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="to">To</Label>
          <Input id="to" type="date" value={to} onChange={(e) => reset(() => setTo(e.target.value))} className="w-40" />
        </div>
        {(batchId !== "all" || from || to) && (
          <Button
            variant="ghost"
            onClick={() =>
              reset(() => {
                setBatchId("all");
                setFrom("");
                setTo("");
              })
            }
          >
            Clear filters
          </Button>
        )}
      </div>
      <Card>
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : !data?.rows.length ? (
          <p className="py-16 text-center text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">Date</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {r.batch ? (
                      <Link className="text-primary hover:underline" href={`/batches/${r.batch.id}/review`}>
                        {r.batch.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{r.action}</code>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.details}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {data && data.pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">
            Page {data.page} of {data.pages} · {data.total} entries
          </span>
          <Button
            size="icon-sm"
            variant="outline"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft />
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
            disabled={page >= data.pages}
            aria-label="Next page"
          >
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}
