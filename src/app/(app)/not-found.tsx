import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState, PageBody } from "@/components/common/page";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <PageBody>
      <EmptyState
        icon={SearchX}
        title="We couldn’t find that"
        description="The page or booking doesn’t exist, or it belongs to a different account."
        action={
          <Link href="/" className={buttonVariants({ variant: "secondary" })}>
            Back to services
          </Link>
        }
        className="my-10"
      />
    </PageBody>
  );
}
