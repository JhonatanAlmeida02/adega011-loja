"use client";

import * as React from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Gaveta (padrão shadcn/ui "Sheet"): no celular abre de baixo para cima
 * (bottom sheet); a partir de `md` abre na lateral direita.
 */
export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;
export const SheetTitle = Dialog.Title;
export const SheetDescription = Dialog.Description;

export function SheetContent({
  className,
  children,
  lado = "responsivo",
  rotuloFechar = "Fechar",
  ...props
}: React.ComponentProps<typeof Dialog.Content> & {
  lado?: "responsivo" | "centro";
  rotuloFechar?: string;
}) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] data-[state=open]:animate-[fade-in_0.2s_ease-out] data-[state=closed]:animate-[fade-out_0.15s_ease-in]" />
      <Dialog.Content
        className={cn(
          "fixed z-50 flex flex-col bg-superficie text-branco shadow-2xl outline-none",
          lado === "responsivo" &&
            "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-[1.75rem] border-t border-borda data-[state=open]:animate-[sobe_0.3s_cubic-bezier(0.2,0.8,0.2,1)] data-[state=closed]:animate-[desce_0.2s_ease-in] md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[440px] md:rounded-none md:rounded-l-[1.75rem] md:border-t-0 md:border-l md:data-[state=open]:animate-[entra-direita_0.3s_cubic-bezier(0.2,0.8,0.2,1)] md:data-[state=closed]:animate-[sai-direita_0.2s_ease-in]",
          lado === "centro" &&
            "inset-x-4 top-1/2 mx-auto max-h-[90dvh] max-w-md -translate-y-1/2 rounded-[1.75rem] border border-borda data-[state=open]:animate-[fade-in_0.2s_ease-out]",
          className,
        )}
        {...props}
      >
        {lado === "responsivo" && (
          <div aria-hidden className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-superficie-3 md:hidden" />
        )}
        {children}
        <Dialog.Close
          className="absolute right-3 top-3 inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-suave transition-colors hover:bg-superficie-3 hover:text-branco"
          aria-label={rotuloFechar}
        >
          <X className="size-5" />
        </Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  );
}
