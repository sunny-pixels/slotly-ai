import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const toneClass: Record<Tone, string> = {
  neutral: "bg-canvas-sunken text-ink-muted",
  brand: "bg-accent-faint text-brand",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
  info: "bg-info-bg text-info",
};

export function Badge({ tone = "neutral", className, children, dot }: { tone?: Tone; className?: string; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm px-2 py-0.5 text-[0.75rem] font-medium", toneClass[tone], className)}>
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const bookingTone: Record<string, { tone: Tone; label: string }> = {
  PENDING: { tone: "warning", label: "Pending" },
  CONFIRMED: { tone: "success", label: "Confirmed" },
  CANCELLED: { tone: "neutral", label: "Cancelled" },
  COMPLETED: { tone: "info", label: "Completed" },
};

export function BookingStatusBadge({ status }: { status: string }) {
  const s = bookingTone[status] ?? { tone: "neutral" as Tone, label: status };
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

const ingestionTone: Record<string, { tone: Tone; label: string }> = {
  PENDING: { tone: "neutral", label: "Queued" },
  PROCESSING: { tone: "warning", label: "Processing" },
  READY: { tone: "success", label: "Ready" },
  FAILED: { tone: "danger", label: "Failed" },
};

export function IngestionBadge({ status }: { status: string }) {
  const s = ingestionTone[status] ?? { tone: "neutral" as Tone, label: status };
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

const noticeIcon = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle } as const;

/** Inline message block for contextual information, warnings and errors. */
export function Notice({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: keyof typeof noticeIcon;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const Icon = noticeIcon[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-md px-4 py-3 text-[0.875rem]", toneClass[tone], className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-ink/80">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
