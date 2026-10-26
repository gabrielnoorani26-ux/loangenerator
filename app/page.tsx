"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  CheckCircle2,
  Copy,
  Images,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Search,
  Sparkles,
  Trash2,
  FolderOpen,
  PackageOpen,
} from "lucide-react";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";
import { useAppSettings } from "@/lib/client/hooks";
import { batchHrefFor } from "@/lib/client/routes";
import { useDebounced } from "@/lib/client/use-debounced";
import type { BatchDTO } from "@/lib/batches";
import type { Stats } from "@/lib/stats";
import { NewBatchButton } from "@/components/new-batch-button";
import { BatchStatusBadge } from "@/components/status-badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDate } from "@/lib/utils";

const STATUSES = ["DRAFT", "READY", "PROCESSING", "PAUSED", "REVIEW", "COMPLETE", "CANCELLED"];

export default function DashboardPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [brand, setBrand] = useState("all");
  const [sort, setSort] = useState("newest");
  const [view, setView] = useState<"cards" | "table">("cards");
  const debouncedSearch = useDebounced(search, 300);
  const { data: app } = useAppSettings();

  const params = new URLSearchParams({ sort });
  if (debouncedSearch) params.set("search", debouncedSearch);
  if (status !== "all") params.set("status", status);
  if (brand !== "all") params.set("brand", brand);

  const { data: batches, isLoading } = useQuery({
    queryKey: ["batches", params.toString()],
    queryFn: async () => (await apiGet<{ batches: BatchDTO[] }>(`/api/batches?${params}`)).batches,
    refetchInterval: (q) => (q.state.data?.some((b) => b.status === "PROCESSING") ? 3000 : false),
  });
  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: () => apiGet<Stats>("/api/stats") });
  const filtered = status !== "all" || brand !== "all" || !!debouncedSearch;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Bulk-edit product photos with AI and standard edits.</p>
        </div>
        <NewBatchButton />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Images} label="Images processed this week" value={stats?.imagesProcessedThisWeek} />
        <StatCard icon={Activity} label="Active batches" value={stats?.activeBatches} />
        <StatCard icon={Sparkles} label="AI calls this month" value={stats?.aiCallsThisMonth} />
        <StatCard
          icon={CheckCircle2}
          label="Avg approval rate"
          value={stats ? (stats.avgApprovalRate == null ? "—" : `${stats.avgApprovalRate}%`) : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search batches…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search batches"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-36" aria-label="Status filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={brand} onValueChange={setBrand}>
          <SelectTrigger className="w-40" aria-label="Brand filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All brands</SelectItem>
            {(app?.brandList ?? []).map((b) => (
              <SelectItem key={b} value={b}>
                {b}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-36" aria-label="Sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="oldest">Oldest</SelectItem>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="images">Most images</SelectItem>
          </SelectContent>
        </Select>
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(v) => v && setView(v as "cards" | "table")}
          className="hidden md:inline-flex"
        >
          <ToggleGroupItem value="cards" aria-label="Card view">
            <LayoutGrid />
          </ToggleGroupItem>
          <ToggleGroupItem value="table" aria-label="Table view">
            <List />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      ) : !batches?.length ? (
        filtered ? (
          <div className="rounded-lg border bg-card py-16 text-center text-muted-foreground">
            No batches match these filters.
          </div>
        ) : (
          <div
            className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-card py-20 text-center"
            data-testid="empty-state"
          >
            <PackageOpen className="size-12 text-primary" />
            <h2 className="text-lg font-semibold">No batches yet</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              Create a batch, drop in 100–200 product photos, pick a preset, and BatchLens edits them all. Originals are
              never modified.
            </p>
            <NewBatchButton size="lg" label="Create your first batch" />
          </div>
        )
      ) : view === "table" ? (
        <BatchTable batches={batches} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="batch-cards">
          {batches.map((b) => (
            <BatchCard key={b.id} batch={b} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode | undefined;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-5">
        <span className="rounded-md bg-accent p-2 text-primary">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          {value === undefined ? (
            <Skeleton className="mt-1 h-6 w-12" />
          ) : (
            <p className="text-xl font-semibold tabular-nums">{value}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function progressOf(b: BatchDTO) {
  return b.totalImages ? Math.round(((b.completedCount + b.failedCount) / b.totalImages) * 100) : 0;
}

function BatchCard({ batch }: { batch: BatchDTO }) {
  const href = batchHrefFor(batch);
  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-md" data-testid="batch-card">
      <Link href={href} className="block">
        <div className="grid h-28 grid-cols-4 gap-px bg-border">
          {Array.from({ length: 4 }).map((_, i) =>
            batch.thumbnails[i] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={batch.thumbnails[i]!}
                alt=""
                className="checkerboard size-full object-contain"
                loading="lazy"
              />
            ) : (
              <div key={i} className="bg-muted" />
            ),
          )}
        </div>
      </Link>
      <CardContent className="space-y-3 pt-4">
        <div className="flex items-start justify-between gap-2">
          <Link href={href} className="min-w-0">
            <h3 className="truncate font-semibold hover:underline">{batch.name}</h3>
            <p className="text-xs text-muted-foreground">
              {formatDate(batch.createdAt)} · {batch.totalImages} images
            </p>
          </Link>
          <BatchMenu batch={batch} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{batch.brand}</Badge>
          <BatchStatusBadge status={batch.status} />
          {batch.presetName && <Badge variant="gray">{batch.presetName}</Badge>}
        </div>
        <div className="space-y-1">
          <Progress value={progressOf(batch)} />
          <p className="flex justify-between text-xs text-muted-foreground">
            <span>
              {batch.approvedCount} approved · {batch.completedCount} done
              {batch.failedCount ? ` · ${batch.failedCount} failed` : ""}
            </span>
            <span>{batch.aiCallsUsed} AI calls</span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function BatchTable({ batches }: { batches: BatchDTO[] }) {
  const router = useRouter();
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Brand</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Progress</TableHead>
            <TableHead>Approved</TableHead>
            <TableHead>AI calls</TableHead>
            <TableHead>Created</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {batches.map((b) => (
            <TableRow key={b.id} className="cursor-pointer" onClick={() => router.push(batchHrefFor(b))}>
              <TableCell className="font-medium">{b.name}</TableCell>
              <TableCell>{b.brand}</TableCell>
              <TableCell>
                <BatchStatusBadge status={b.status} />
              </TableCell>
              <TableCell className="w-40">
                <Progress value={progressOf(b)} />
              </TableCell>
              <TableCell>
                {b.approvedCount}/{b.totalImages}
              </TableCell>
              <TableCell>{b.aiCallsUsed}</TableCell>
              <TableCell>{formatDate(b.createdAt)}</TableCell>
              <TableCell onClick={(e) => e.stopPropagation()}>
                <BatchMenu batch={b} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function BatchMenu({ batch }: { batch: BatchDTO }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState(batch.name);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["batches"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
  };
  const duplicate = async () => {
    try {
      const r = await apiSend<{ batch: BatchDTO }>(`/api/batches/${batch.id}/duplicate-settings`, "POST");
      toast.success("New batch created with the same settings");
      router.push(`/batches/${r.batch.id}/upload`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const rename = async () => {
    try {
      await apiSend(`/api/batches/${batch.id}`, "PATCH", { name });
      setRenameOpen(false);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const remove = async () => {
    try {
      await apiSend(`/api/batches/${batch.id}`, "DELETE");
      toast.success(`Deleted “${batch.name}”`);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label="Batch actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => router.push(batchHrefFor(batch))}>
            <FolderOpen /> Open
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={duplicate}>
            <Copy /> Duplicate settings
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
            <Pencil /> Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setDeleteOpen(true)}
            disabled={batch.status === "PROCESSING"}
          >
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename batch</DialogTitle>
          </DialogHeader>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && rename()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={rename} disabled={!name.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete “${batch.name}”?`}
        description="This permanently deletes the batch, its uploaded originals and all edited images. This can't be undone."
        confirmLabel="Delete batch"
        destructive
        onConfirm={remove}
      />
    </>
  );
}
