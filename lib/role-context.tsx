"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { Role } from "@/lib/types";

const RoleContext = createContext<Role | null>(null);

export function RoleProvider({
  initialRole,
  children,
}: {
  initialRole: Role | null;
  children: ReactNode;
}) {
  return (
    <RoleContext.Provider value={initialRole}>{children}</RoleContext.Provider>
  );
}

export function useActiveRole(): Role | null {
  return useContext(RoleContext);
}
