import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "bg-neutral-900 text-white",
        secondary: "bg-neutral-100 text-neutral-700",
        outline: "border border-neutral-300 text-neutral-700",
        inbox: "bg-blue-50 text-blue-700",
        in_progress: "bg-amber-50 text-amber-700",
        blocked: "bg-red-50 text-red-700",
        done: "bg-green-50 text-green-700",
        operator: "bg-violet-50 text-violet-700",
        builder: "bg-sky-50 text-sky-700",
        urgent: "bg-red-100 text-red-800",
        low: "bg-green-50 text-green-700",
        medium: "bg-amber-50 text-amber-700",
        high: "bg-red-50 text-red-700",
        approved: "bg-green-50 text-green-700",
        needs_approval: "bg-amber-50 text-amber-700",
        sent: "bg-sky-50 text-sky-700",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
