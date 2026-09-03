"use client";

import clsx from "clsx";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { STATUS_TONE, label } from "@/lib/format";

export function Button({
  variant = "default",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "sm" | "md";
}) {
  return (
    <button
      {...props}
      className={clsx(
        "inline-flex items-center justify-center gap-1 rounded-md border font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
        variant === "primary" && "border-sky-700 bg-sky-700 text-white hover:bg-sky-800",
        variant === "default" &&
          "border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-100",
        variant === "danger" && "border-rose-700 bg-rose-700 text-white hover:bg-rose-800",
        variant === "ghost" &&
          "border-transparent bg-transparent text-neutral-700 hover:bg-neutral-100",
        className,
      )}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        "w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm focus:border-sky-500 focus:outline-none",
        className,
      )}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={clsx(
        "w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm focus:border-sky-500 focus:outline-none",
        className,
      )}
    >
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={clsx(
        "w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 font-mono text-xs focus:border-sky-500 focus:outline-none",
        className,
      )}
    />
  );
}

export function Label({
  children,
  className,
  htmlFor,
}: {
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={clsx("mb-1 block text-xs font-medium text-neutral-600", className)}
    >
      {children}
    </label>
  );
}

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("rounded-lg border border-neutral-200 bg-white", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-neutral-800">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Exibe um valor enumerado com rótulo em pt-BR e cor por estado. */
export function Badge({
  value,
  tone,
  className,
}: {
  value: string | null | undefined;
  tone?: string;
  className?: string;
}) {
  if (!value) return <span className="text-neutral-400">—</span>;
  return (
    <span
      className={clsx(
        "inline-block rounded px-1.5 py-0.5 text-xs font-medium",
        tone ?? STATUS_TONE[value] ?? "bg-neutral-200 text-neutral-700",
        className,
      )}
    >
      {label(value)}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-neutral-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-neutral-500">{hint}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error);
  return (
    <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      {message}
    </div>
  );
}

export function Loading({ label = "Carregando…" }: { label?: string }) {
  return <div className="py-6 text-center text-sm text-neutral-500">{label}</div>;
}

export function Empty({ label = "Nada por aqui ainda." }: { label?: string }) {
  return <div className="py-6 text-center text-sm text-neutral-400">{label}</div>;
}

export function ScoreBar({
  value,
  invert = false,
}: {
  value: number | null | undefined;
  invert?: boolean;
}) {
  if (value === null || value === undefined)
    return <span className="text-xs text-neutral-400">n/d</span>;
  const v = invert ? 100 - value : value;
  const color = v >= 70 ? "bg-emerald-500" : v >= 40 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded bg-neutral-200">
        <div
          className={clsx("h-full", color)}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
      <span className="w-7 text-right text-xs tabular-nums">{Math.round(value)}</span>
    </div>
  );
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-neutral-500">{k}</dt>
          <dd className="break-all text-neutral-900">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
