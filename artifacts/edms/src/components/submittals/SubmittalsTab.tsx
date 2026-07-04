import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus, ExternalLink, ClipboardList } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { format } from "date-fns";
import { CreateSubmittalDialog } from "./CreateSubmittalDialog";

interface SubmissionChain {
  id: number;
  chainNumber: string;
  title: string;
  type: string;
  currentStatus: string;
  activeRevisionCycle: number;
  createdAt: string;
}

const STATUS_COLOR: Record<string, string> = {
  draft:     "bg-gray-100 text-gray-600 border-gray-200",
  active:    "bg-blue-100 text-blue-700 border-blue-200",
  returned:  "bg-amber-100 text-amber-700 border-amber-200",
  approved:  "bg-green-100 text-green-700 border-green-200",
  rejected:  "bg-red-100 text-red-700 border-red-200",
  closed:    "bg-slate-100 text-slate-600 border-slate-200",
};

const TYPE_COLOR: Record<string, string> = {
  submittal: "bg-indigo-50 text-indigo-700 border-indigo-200",
  rfi:       "bg-purple-50 text-purple-700 border-purple-200",
  ncr:       "bg-rose-50 text-rose-700 border-rose-200",
  mir:       "bg-teal-50 text-teal-700 border-teal-200",
};

interface Props {
  projectId: number;
}

export function SubmittalsTab({ projectId }: Props) {
  const [, navigate] = useLocation();
  const [createOpen, setCreateOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const { data: chains = [], isLoading } = useQuery<SubmissionChain[]>({
    queryKey: ["submission-chains", projectId],
    queryFn: async () => {
      const res = await apiFetch(`/api/projects/${projectId}/submission-chains`);
      if (!res.ok) throw new Error("Failed to load submittals");
      return res.json();
    },
  });

  const filtered = chains.filter((c) => {
    if (statusFilter !== "all" && c.currentStatus !== statusFilter) return false;
    if (typeFilter !== "all" && c.type !== typeFilter) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[150px] h-8 text-sm">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="returned">Returned</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[130px] h-8 text-sm">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="submittal">Submittal</SelectItem>
              <SelectItem value="rfi">RFI</SelectItem>
              <SelectItem value="ncr">NCR</SelectItem>
              <SelectItem value="mir">MIR</SelectItem>
            </SelectContent>
          </Select>
          {(statusFilter !== "all" || typeFilter !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => { setStatusFilter("all"); setTypeFilter("all"); }}
            >
              Clear filters
            </Button>
          )}
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          New Submittal
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 rounded-xl border border-dashed">
          <ClipboardList className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
          <p className="font-medium text-muted-foreground">
            {chains.length === 0 ? "No submittals yet" : "No submittals match the current filters"}
          </p>
          {chains.length === 0 && (
            <Button className="mt-4" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Create First Submittal
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-[110px]">Number</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className="w-[100px]">Type</TableHead>
                <TableHead className="w-[110px]">Status</TableHead>
                <TableHead className="w-[80px] text-center">Rev.</TableHead>
                <TableHead className="w-[110px]">Created</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((chain) => (
                <TableRow
                  key={chain.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => navigate(`/projects/${projectId}/submittals/${chain.id}`)}
                >
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {chain.chainNumber}
                  </TableCell>
                  <TableCell className="font-medium">{chain.title}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`uppercase text-[10px] ${TYPE_COLOR[chain.type] ?? ""}`}
                    >
                      {chain.type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`capitalize text-[10px] ${STATUS_COLOR[chain.currentStatus] ?? ""}`}
                    >
                      {chain.currentStatus}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center text-sm text-muted-foreground">
                    {chain.activeRevisionCycle}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {format(new Date(chain.createdAt), "dd MMM yyyy")}
                  </TableCell>
                  <TableCell>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateSubmittalDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        projectId={projectId}
      />
    </div>
  );
}
