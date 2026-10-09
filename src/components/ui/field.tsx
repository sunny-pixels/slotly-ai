import * as React from "react";
import { Label as LabelPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

const control =
  "w-full rounded-md border border-line-strong bg-surface px-3 text-[0.875rem] text-ink shadow-xs transition-colors placeholder:text-ink-subtle hover:border-ink-subtle focus-visible:border-brand-soft disabled:cursor-not-allowed disabled:bg-canvas-sunken disabled:text-ink-muted aria-invalid:border-danger aria-invalid:focus-visible:shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--danger)]";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(control, "h-9.5", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-24 py-2 leading-relaxed", className)} {...props} />;
}

/** Native select — fully accessible and keyboard friendly, styled to match. */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className={cn("relative", className)}>
      <select className={cn(control, "h-9.5 appearance-none pr-9")} {...props}>
        {children}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
      >
        <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn("text-meta font-medium text-ink", className)} {...props} />;
}

/** Label + control + hint/error, wired with aria attributes. */
export function Field({
  id,
  label,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | string[];
  className?: string;
  children: React.ReactElement<{ id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }>;
}) {
  const message = Array.isArray(error) ? error[0] : error;
  const describedBy = [hint ? `${id}-hint` : null, message ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {React.cloneElement(children, { id, "aria-invalid": message ? true : undefined, "aria-describedby": describedBy })}
      {hint && !message && (
        <p id={`${id}-hint`} className="text-meta text-ink-muted">
          {hint}
        </p>
      )}
      {message && (
        <p id={`${id}-error`} className="text-meta text-danger" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
