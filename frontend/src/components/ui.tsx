import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function Card({
  title,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-white/10 bg-white/[0.03] p-4 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold text-slate-200">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "subtle";
};

export function Button({ variant = "primary", className = "", ...props }: BtnProps) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed";
  const styles: Record<string, string> = {
    primary: "bg-brand hover:bg-brand-dark text-white",
    ghost: "border border-white/15 hover:bg-white/10 text-slate-200",
    subtle: "bg-white/5 hover:bg-white/10 text-slate-200",
    danger: "bg-red-500/90 hover:bg-red-500 text-white",
  };
  return <button className={`${base} ${styles[variant]} ${className}`} {...props} />;
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-brand ${className}`}
      {...props}
    />
  );
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-brand ${className}`}
      {...props}
    />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      {children}
    </label>
  );
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "red" | "blue" }) {
  const tones: Record<string, string> = {
    slate: "bg-slate-500/20 text-slate-300",
    green: "bg-emerald-500/20 text-emerald-300",
    red: "bg-red-500/20 text-red-300",
    blue: "bg-brand/20 text-brand",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>
  );
}
