import { getCurrentUser } from "@/server/authz";
import { MobileNav, Sidebar, type ShellUser } from "@/components/shell/nav";

/**
 * Full-width application shell: a navigation sidebar plus a flexible workspace
 * that takes all remaining viewport width. Pages control their own inner grids;
 * there is deliberately no global max-width container.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const shellUser: ShellUser = user ? { name: user.name, email: user.email, role: user.role } : null;
  return (
    <div className="flex min-h-dvh w-full">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-brand px-3 py-2 text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <Sidebar user={shellUser} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav user={shellUser} />
        <main id="main" className="flex-1 px-(--page-gutter)">
          {children}
        </main>
      </div>
    </div>
  );
}
