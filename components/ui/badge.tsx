import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        gray: "border-transparent bg-gray-100 text-gray-700",
        blue: "border-transparent bg-blue-100 text-blue-700",
        slate: "border-transparent bg-slate-200 text-slate-800",
        green: "border-transparent bg-emerald-100 text-emerald-700",
        red: "border-transparent bg-red-100 text-red-700",
        redOutline: "border-red-400 bg-white text-red-600",
        amber: "border-transparent bg-amber-100 text-amber-800",
        indigo: "border-transparent bg-indigo-100 text-indigo-700",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
export { Badge, badgeVariants };
