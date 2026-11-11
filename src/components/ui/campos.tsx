import * as React from "react";
import { cn } from "@/lib/utils";

const baseCampo =
  "w-full rounded-xl border border-borda bg-superficie-2 px-4 text-base text-branco placeholder:text-[#8f8f8f] transition-colors focus-visible:border-rosa focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rosa/40 aria-[invalid=true]:border-perigo disabled:opacity-60";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input data-slot="input" className={cn(baseCampo, "h-12", className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea data-slot="textarea" className={cn(baseCampo, "min-h-24 py-3", className)} {...props} />;
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select data-slot="select" className={cn(baseCampo, "h-12 appearance-none pr-10", className)} {...props}>
        {children}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        className="pointer-events-none absolute right-3 top-1/2 size-5 -translate-y-1/2 text-suave"
      >
        <path d="M5 7.5 10 12.5 15 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("rotulo mb-2 block text-suave", className)} {...props} />;
}

export function Campo({
  label,
  htmlFor,
  erro,
  ajuda,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  erro?: string;
  ajuda?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {erro ? (
        <p id={`${htmlFor}-erro`} role="alert" className="mt-1.5 text-sm text-perigo">
          {erro}
        </p>
      ) : ajuda ? (
        <p className="mt-1.5 text-sm text-suave">{ajuda}</p>
      ) : null}
    </div>
  );
}

/** Interruptor acessível (role="switch"). */
export function Interruptor({
  checked,
  onCheckedChange,
  label,
  id,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-8 w-14 shrink-0 cursor-pointer items-center rounded-full border-2 transition-colors disabled:opacity-50",
        checked ? "border-rosa bg-rosa" : "border-borda bg-superficie-3",
      )}
    >
      <span
        className={cn(
          "inline-block size-6 rounded-full bg-preto shadow transition-transform",
          checked ? "translate-x-[1.6rem]" : "translate-x-0.5 bg-suave",
        )}
      />
    </button>
  );
}
