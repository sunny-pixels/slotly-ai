import { Skeleton } from "@/components/ui/data";

/** Generic page skeleton shown while server data streams in. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-8 py-6 lg:py-8" aria-busy="true" aria-label="Loading">
      <div className="space-y-3 border-b border-line pb-6">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-[min(36rem,90%)]" />
      </div>
      <Skeleton className="h-12 w-full" />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))] gap-4">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-52" />
        ))}
      </div>
    </div>
  );
}
