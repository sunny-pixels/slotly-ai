import { getCurrentUser } from "@/server/authz";
import { getLlm } from "@/server/rag/llm";
import { getConfig } from "@/lib/config";
import { PageHeader } from "@/components/common/page";
import { AssistantWorkspace } from "@/components/assistant/assistant-workspace";

export const metadata = { title: "Booking assistant" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AssistantPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const { BUSINESS_TIMEZONE: tz, CANCELLATION_CUTOFF_HOURS } = getConfig();
  const llm = getLlm();
  const initialQuestion = typeof sp.q === "string" ? sp.q.slice(0, 300) : undefined;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col py-5 md:h-dvh lg:py-6">
      <PageHeader
        className="pb-5"
        title="Booking assistant"
        description="Ask about services and policies, check live open times, or book and cancel — every change waits for your confirmation."
      />
      <AssistantWorkspace
        signedIn={Boolean(user)}
        userName={user?.name.split(" ")[0]}
        timeZone={tz}
        cutoffHours={CANCELLATION_CUTOFF_HOURS}
        generation={llm ? `${llm.name} · ${llm.model}` : null}
        initialQuestion={initialQuestion}
      />
    </div>
  );
}
