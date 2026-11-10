import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-bold transition-[transform,background-color,color,box-shadow] duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0 cursor-pointer select-none",
  {
    variants: {
      variant: {
        // Texto preto sobre rosa (6,7:1) — nunca branco sobre rosa.
        primario: "bg-rosa text-preto hover:bg-[#ff7a9f] shadow-[0_8px_24px_-8px_rgba(255,92,138,0.6)]",
        destaque: "bg-amarelo text-preto hover:bg-[#ffd23f]",
        contorno: "border-2 border-rosa text-rosa hover:bg-rosa hover:text-preto",
        fantasma: "text-branco hover:bg-superficie-3",
        suave: "bg-superficie-2 text-branco hover:bg-superficie-3 border border-borda",
        perigo: "bg-perigo text-preto hover:bg-[#ff8787]",
        whatsapp: "bg-[#25D366] text-preto hover:bg-[#3ee07a]",
      },
      size: {
        sm: "h-10 px-4 text-sm",
        md: "h-12 px-5 text-base",
        lg: "h-14 px-7 text-lg",
        icone: "size-11",
        "icone-sm": "size-9 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "primario", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
