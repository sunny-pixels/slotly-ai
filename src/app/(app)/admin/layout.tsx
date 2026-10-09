import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { getPageUser } from "@/server/page-guards";
import { EmptyState, PageBody, PageHeader } from "@/components/common/page";
import { SignInPrompt } from "@/components/shell/account-picker";
import { buttonVariants } from "@/components/ui/button";

/**
 * Admin pages are rendered only for administrators. This is a UX guard —
 * every admin API route independently calls requireAdmin() on the server.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getPageUser();
  if (!user) {
    return (
      <PageBody>
        <PageHeader eyebrow="Studio admin" title="Administrator access" description="Continue as the demo administrator to manage the studio." />
        <div className="max-w-[34rem]">
          <SignInPrompt />
        </div>
      </PageBody>
    );
  }
  if (user.role !== "ADMIN") {
    return (
      <PageBody>
        <EmptyState
          icon={ShieldAlert}
          title="Administrator access required"
          description="This account doesn't have permission to view the studio admin area. Switch to the admin demo account from the menu in the sidebar."
          action={
            <Link href="/" className={buttonVariants({ variant: "secondary" })}>
              Back to services
            </Link>
          }
        />
      </PageBody>
    );
  }
  return children;
}
