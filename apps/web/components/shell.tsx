"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { UserSummary } from "@dominio-x/contracts";
import { api } from "@/lib/api";
import { label } from "@/lib/format";
import { Button } from "./ui";

const NAV: { href: string; label: string }[] = [
  { href: "/", label: "Visão geral" },
  { href: "/domains", label: "Domínios" },
  { href: "/batches", label: "Lotes de liberação" },
  { href: "/queue", label: "Fila de análise" },
  { href: "/shortlists", label: "Shortlists" },
  { href: "/rules", label: "Regras" },
  { href: "/providers", label: "Provedores" },
  { href: "/usage", label: "Uso e custos" },
  { href: "/audit", label: "Auditoria" },
  { href: "/settings", label: "Configurações" },
];

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<{ user: UserSummary }>("/auth/me"),
    retry: false,
    staleTime: 60_000,
  });
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();

  if (me.isLoading) return <div className="p-8 text-sm text-neutral-500">Carregando sessão…</div>;
  if (me.isError || !me.data) {
    if (typeof window !== "undefined")
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    return null;
  }
  const user = me.data.user;

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-4 py-3">
          <Link href="/" className="text-base font-bold tracking-tight text-neutral-900">
            Dominio-X
          </Link>
          <div className="text-[11px] text-neutral-500">inteligência de domínios</div>
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  "block rounded-md px-3 py-1.5 text-sm",
                  active
                    ? "bg-sky-50 font-medium text-sky-800"
                    : "text-neutral-700 hover:bg-neutral-100",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-neutral-200 p-3 text-xs text-neutral-600">
          <div className="truncate font-medium text-neutral-800">{user.email}</div>
          <div className="mb-2">{label(user.role)}</div>
          <Button
            size="sm"
            onClick={async () => {
              await api.post("/auth/logout").catch(() => undefined);
              qc.clear();
              router.replace("/login");
            }}
          >
            Sair
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}

export function useRole() {
  const me = useMe();
  const role = me.data?.user.role ?? "viewer";
  return { role, isAnalyst: role === "analyst" || role === "admin", isAdmin: role === "admin" };
}
