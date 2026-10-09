import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "./db";
import type { Role } from "@/generated/prisma/enums";
import { demoAccountEmail, demoAccountsEnabled, isDemoAccountKey } from "@/lib/demo-accounts";

declare module "next-auth" {
  interface Session {
    user: { id: string; role: Role } & DefaultSession["user"];
  }
  interface User {
    role?: Role;
  }
}

const isRole = (v: unknown): v is Role => v === "CUSTOMER" || v === "ADMIN";

/**
 * Authentication uses Auth.js with signed, HTTP-only JWT session cookies.
 *
 * The only provider is the demo-account switcher: the client sends an account
 * *key* ("maya" | "sam" | "admin"), never an email or id, and the server maps it
 * to a seeded user. It is gated by DEMO_ACCOUNTS_ENABLED and must be replaced by
 * a real provider (email/password, OAuth, magic link) before handling real
 * customers — see README → Authentication.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  pages: { signIn: "/" },
  trustHost: true,
  logger: {
    error(error) {
      // A session cookie signed with a different AUTH_SECRET (e.g. left over from another
      // localhost app, or after rotating the secret) is simply treated as "signed out".
      // Log one short line instead of a stack trace; the cookie is replaced on next sign-in.
      if (error.name === "JWTSessionError") {
        console.warn("[auth] ignored an invalid session cookie (signed with a different AUTH_SECRET); treating the visitor as signed out.");
        return;
      }
      console.error("[auth]", error);
    },
  },
  providers: [
    Credentials({
      id: "demo",
      name: "Demo account",
      credentials: { account: { label: "Account", type: "text" } },
      async authorize(raw) {
        if (!demoAccountsEnabled()) return null;
        const key = raw?.account;
        if (!isDemoAccountKey(key)) return null;
        const user = await prisma.user.findUnique({ where: { email: demoAccountEmail(key) } });
        if (!user) return null;
        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) {
        token.uid = user.id;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      // The role here is only a UI hint; authorization re-reads it from the DB (see authz.ts).
      if (typeof token.uid === "string") {
        session.user.id = token.uid;
        session.user.role = isRole(token.role) ? token.role : "CUSTOMER";
      }
      return session;
    },
  },
});
