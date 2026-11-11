import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-bold transition-[transform,background-color,color,box-shadow] duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer select-none",
  {
    variants: {
      variant: {
        // Fundo da cor de ação do tema, sempre com texto preto.
        primario: "bg-rosa text-preto hover:bg-rosa-hover shadow-[0_8px_24px_-8px_var(--acao-brilho)]",
        destaque: "bg-amarelo text-preto hover:bg-[#ffd23f]",
        contorno: "border-2 border-rosa text-rosa-texto hover:bg-rosa hover:text-preto",
        fantasma: "text-texto hover:bg-superficie-3",
        suave: "bg-superficie-2 text-texto hover:bg-superficie-3 border border-borda",
        perigo: "bg-perigo-vivo text-preto hover:bg-[#ff8787]",
        whatsapp: "bg-[#25D366] text-preto hover:bg-[#3ee07a]",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4 text-sm",
        lg: "h-11 px-5 text-base",
        icone: "size-9",
        "icone-sm": "size-8 [&_svg]:size-4",
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
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
