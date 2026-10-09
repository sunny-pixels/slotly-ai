import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8", className)}>
      <rect width="32" height="32" rx="8" fill="var(--brand-800)" />
      <rect x="7" y="9" width="18" height="4" rx="2" fill="var(--mint-300)" />
      <rect x="7" y="15" width="11" height="4" rx="2" fill="var(--mint-300)" opacity="0.55" />
      <rect x="7" y="21" width="14" height="4" rx="2" fill="var(--mint-300)" opacity="0.3" />
      <circle cx="23" cy="23" r="3" fill="var(--mint-300)" />
    </svg>
  );
}

export function Logo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      {!collapsed && (
        <span className="font-display text-[1.0625rem] font-bold tracking-tight text-ink">
          Slotly<span className="ml-1 rounded-sm bg-accent px-1 py-px text-[0.6875rem] font-bold uppercase tracking-wide text-brand-strong">AI</span>
        </span>
      )}
    </span>
  );
}
