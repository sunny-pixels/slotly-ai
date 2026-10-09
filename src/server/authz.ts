import "server-only";
import { cache } from "react";
import { auth } from "./auth";
import { prisma } from "./db";
import { ForbiddenError, UnauthorizedError } from "./errors";
import type { Role } from "@/generated/prisma/enums";

/**
 * Data-access-layer authorization. Every protected route handler and server
 * page calls one of these — UI visibility is never treated as authorization.
 *
 * The session JWT only identifies the user; the role is re-read from the
 * database on every request so a demoted administrator loses access at once.
 */
export type Actor = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

export const getCurrentUser = cache(async (): Promise<Actor | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true },
  });
  return user ?? null;
});

export async function requireUser(): Promise<Actor> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export async function requireAdmin(): Promise<Actor> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new ForbiddenError("Administrator access is required.");
  return user;
}

export function isAdmin(actor: Pick<Actor, "role"> | null | undefined): boolean {
  return actor?.role === "ADMIN";
}
