import "server-only";
import { getCurrentUser, type Actor } from "./authz";

/**
 * Server-page guard. Returns the signed-in user, or null — in which case the
 * page renders <SignInPrompt/> instead of any protected data. (There is no
 * separate sign-in page; identities come from the demo-account switcher.)
 */
export async function getPageUser(): Promise<Actor | null> {
  return getCurrentUser();
}
