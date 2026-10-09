"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { toast } from "sonner";
import { Eye, FileUp, MoreHorizontal, Power, RefreshCcw, Trash2, Type } from "lucide-react";
import { api, ApiError } from "@/lib/api-client";
import { formatInZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  SheetContent,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/menu";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/field";
import { Skeleton, Table, TableFrame, TD, TH, THead, TR } from "@/components/ui/data";
import { Badge, IngestionBadge, Notice } from "@/components/common/status";
import { SectionHeader } from "@/components/common/page";

type Doc = {
  id: string;
  slug: string;
  title: string;
  category: string;
  sourceType: string;
  version: number;
  status: string;
  error: string | null;
  chunkCount: number;
  isActive: boolean;
  supersededBy: string | null;
  effectiveDate: string | null;
  embeddingModel: string | null;
  ingestedAt: string | null;
  updatedAt: string;
};

type Chunk = { id: string; chunkIndex: number; headingPath: string; content: string; tokenEstimate: number };

const CATEGORIES = ["policy", "faq", "services", "hours", "general"] as const;

export function KnowledgeAdmin({
  documents,
  pipeline,
  timeZone,
}: {
  documents: Doc[];
  pipeline: { embedding: string; llm: string; topK: number; chunkSize: number; overlap: number; maxDistance: number };
  timeZone: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<Doc | null>(null);
  const [chunks, setChunks] = useState<Chunk[] | null>(null);
  const [toDelete, setToDelete] = useState<Doc | null>(null);

  async function act(key: string, fn: () => Promise<unknown>, success: string) {
    setBusy(key);
    try {
      await fn();
      toast.success(success);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  async function openPreview(doc: Doc) {
    setPreview(doc);
    setChunks(null);
    try {
      const res = await api<{ document: { chunks: Chunk[] } }>(`/api/admin/knowledge/documents/${doc.id}/chunks`);
      setChunks(res.document.chunks);
    } catch {
      setChunks([]);
      toast.error("Couldn't load chunks");
    }
  }

  const active = documents.filter((d) => d.isActive && d.status === "READY");
  const totalChunks = active.reduce((s, d) => s + d.chunkCount, 0);

  return (
    <div className="grid gap-(--section-gap) 2xl:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)]">
      <section aria-labelledby="docs" className="flex min-w-0 flex-col gap-4">
        <SectionHeader id="docs" title="Documents" description={`${active.length} searchable · ${totalChunks} chunks indexed`} />
        <TableFrame>
          <Table>
            <THead>
              <tr>
                <TH>Document</TH>
                <TH>Category</TH>
                <TH>Version</TH>
                <TH>Status</TH>
                <TH>Chunks</TH>
                <TH>Indexed</TH>
                <TH className="text-right">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <tbody>
              {documents.map((d) => (
                <TR key={d.id} className={cn(!d.isActive && "text-ink-muted")}>
                  <TD className="max-w-[28rem]">
                    <p className="font-semibold text-ink">{d.title}</p>
                    <p className="flex flex-wrap items-center gap-1.5 text-[0.75rem] text-ink-subtle">
                      <span className="font-mono">{d.slug}</span>
                      <span>· {d.sourceType.toLowerCase()}</span>
                      {d.effectiveDate && <span>· effective {d.effectiveDate}</span>}
                    </p>
                    {!d.isActive && (
                      <Badge className="mt-1">{d.supersededBy ? `Superseded by ${d.supersededBy}` : "Inactive — not searched"}</Badge>
                    )}
                    {d.error && <p className="mt-1 text-[0.75rem] text-danger">{d.error}</p>}
                  </TD>
                  <TD className="capitalize">{d.category}</TD>
                  <TD className="tabular">v{d.version}</TD>
                  <TD>
                    <IngestionBadge status={busy === d.id ? "PROCESSING" : d.status} />
                  </TD>
                  <TD className="tabular">{d.chunkCount}</TD>
                  <TD className="whitespace-nowrap text-meta text-ink-muted">{d.ingestedAt ? formatInZone(d.ingestedAt, "d MMM, HH:mm", timeZone) : "—"}</TD>
                  <TD className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${d.title}`} disabled={busy === d.id}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => void openPreview(d)}>
                          <Eye /> View chunks
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            void act(d.id, () => api(`/api/admin/knowledge/documents/${d.id}/reprocess`, { method: "POST" }), `Re-indexed “${d.title}”`)
                          }
                        >
                          <RefreshCcw /> Re-process
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            void act(
                              d.id,
                              () => api(`/api/admin/knowledge/documents/${d.id}`, { method: "PATCH", json: { isActive: !d.isActive } }),
                              d.isActive ? `“${d.title}” retired from search` : `“${d.title}” is searchable again`,
                            )
                          }
                        >
                          <Power /> {d.isActive ? "Retire (stop searching)" : "Re-activate"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem tone="danger" onSelect={() => setToDelete(d)}>
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableFrame>
      </section>

      <aside className="flex flex-col gap-(--section-gap)">
        <AddDocument onAdded={() => router.refresh()} />
        <section aria-labelledby="pipeline" className="flex flex-col gap-3">
          <SectionHeader id="pipeline" title="Retrieval pipeline" />
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg bg-canvas-sunken/70 p-4 text-meta">
            <dt className="text-ink-muted">Embeddings</dt>
            <dd className="break-all font-mono text-[0.75rem]">{pipeline.embedding}</dd>
            <dt className="text-ink-muted">Answer writer</dt>
            <dd>{pipeline.llm}</dd>
            <dt className="text-ink-muted">Chunking</dt>
            <dd>
              {pipeline.chunkSize} chars, {pipeline.overlap} overlap
            </dd>
            <dt className="text-ink-muted">Retrieval</dt>
            <dd>
              top {pipeline.topK}, cosine distance ≤ {pipeline.maxDistance}
            </dd>
          </dl>
          <p className="text-[0.75rem] text-ink-muted">
            Documents embedded with a different model are excluded from search until re-processed. Unchanged documents are never re-embedded.
          </p>
        </section>
      </aside>

      <DialogPrimitive.Root open={Boolean(preview)} onOpenChange={(o) => !o && setPreview(null)}>
        <SheetContent className="w-[min(100vw,40rem)]">
          <div className="border-b border-line px-6 py-5">
            <DialogPrimitive.Title className="font-display text-section font-semibold">{preview?.title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-meta text-ink-muted">
              Exactly the text the assistant can retrieve · v{preview?.version} · {preview?.chunkCount} chunks
            </DialogPrimitive.Description>
          </div>
          <ol className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
            {chunks === null
              ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28" />)
              : chunks.map((c) => (
                  <li key={c.id} className="rounded-md border border-line p-3">
                    <p className="mb-2 flex justify-between gap-3 text-[0.75rem] text-ink-subtle">
                      <span>
                        #{c.chunkIndex + 1}
                        {c.headingPath ? ` · ${c.headingPath}` : ""}
                      </span>
                      <span className="tabular">~{c.tokenEstimate} tokens</span>
                    </p>
                    <p className="whitespace-pre-wrap text-meta text-ink">{c.content}</p>
                  </li>
                ))}
          </ol>
        </SheetContent>
      </DialogPrimitive.Root>

      <AlertDialog open={Boolean(toDelete)} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <div className="space-y-2">
            <AlertDialogTitle>Delete “{toDelete?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The document and its {toDelete?.chunkCount} indexed chunks are removed permanently. To keep it for audit, retire it instead.
            </AlertDialogDescription>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="danger"
                onClick={() => {
                  const d = toDelete;
                  if (d) void act(d.id, () => api(`/api/admin/knowledge/documents/${d.id}`, { method: "DELETE" }), `Deleted “${d.title}”`);
                }}
              >
                Delete document
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AddDocument({ onAdded }: { onAdded: () => void }) {
  const [mode, setMode] = useState<"upload" | "text">("upload");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setSaving(true);
    setError(null);
    try {
      let res: { result: { status: string; chunkCount: number; error?: string } };
      if (mode === "upload") {
        const file = fd.get("file");
        if (!(file instanceof File) || file.size === 0) throw new ApiError("Choose a .md or .txt file.", 400, "VALIDATION_ERROR");
        if (file.size > 512 * 1024) throw new ApiError("Files are limited to 512 KB.", 400, "VALIDATION_ERROR");
        const r = await fetch("/api/admin/knowledge/documents", { method: "POST", body: fd });
        const body = await r.json().catch(() => null);
        if (!r.ok && !body?.result) throw new ApiError(body?.error?.message ?? `Upload failed (${r.status}).`, r.status, body?.error?.code ?? "HTTP_ERROR");
        res = body;
      } else {
        res = await api("/api/admin/knowledge/documents", {
          method: "POST",
          json: { title: fd.get("title"), category: fd.get("category"), content: fd.get("content") },
        });
      }
      if (res.result.status === "READY") {
        toast.success("Document indexed", { description: `${res.result.chunkCount} chunks are now searchable.` });
        form.reset();
      } else {
        toast.error("Ingestion failed", { description: res.result.error });
      }
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="add-doc" className="flex flex-col gap-3">
      <SectionHeader id="add-doc" title="Add a document" description="Markdown or plain text, up to 512 KB. Re-using a title updates that document." />
      <Tabs value={mode} onValueChange={(v) => setMode(v as "upload" | "text")}>
        <TabsList>
          <TabsTrigger value="upload">
            <span className="flex items-center gap-1.5">
              <FileUp className="size-3.5" /> Upload file
            </span>
          </TabsTrigger>
          <TabsTrigger value="text">
            <span className="flex items-center gap-1.5">
              <Type className="size-3.5" /> Paste text
            </span>
          </TabsTrigger>
        </TabsList>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-4 rounded-lg border border-line bg-surface p-4" noValidate>
          <div className="grid grid-cols-[1fr_9rem] gap-3">
            <Field id="doc-title" label="Title" hint={mode === "upload" ? "Defaults to the file name" : undefined}>
              <Input name="title" required={mode === "text"} maxLength={120} />
            </Field>
            <Field id="doc-category" label="Category">
              <NativeSelect name="category" defaultValue="policy">
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <TabsContent value="upload">
            <Field id="doc-file" label="File">
              <Input name="file" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" className="h-auto py-1.5 file:mr-3 file:rounded-sm file:border-0 file:bg-canvas-sunken file:px-2 file:py-1 file:text-meta" />
            </Field>
          </TabsContent>
          <TabsContent value="text">
            <Field id="doc-content" label="Content" hint="Use # headings — each section becomes its own retrievable chunk.">
              <Textarea name="content" rows={8} maxLength={200000} className="font-mono text-[0.8125rem]" />
            </Field>
          </TabsContent>
          {error && <Notice tone="danger">{error}</Notice>}
          <Button type="submit" loading={saving}>
            {saving ? "Chunking and embedding…" : "Add and index"}
          </Button>
        </form>
      </Tabs>
    </section>
  );
}
