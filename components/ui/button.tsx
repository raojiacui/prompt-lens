import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D97757]/35 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-[#D97757] text-white shadow-sm hover:bg-[#C96848] hover:shadow-md",
        destructive:
          "bg-[#C0453A] text-white shadow-sm hover:bg-[#A83A30]",
        outline:
          "border border-[#C8C4BC] bg-transparent shadow-sm text-[#6B6860] hover:bg-[#F5F3EC] hover:text-[#141413] hover:border-[#141413]",
        secondary:
          "bg-[#D8D5CC] text-[#141413] shadow-sm hover:bg-[#C8C4BC]",
        ghost: "text-[#6B6860] hover:bg-[#D8D5CC]/50 hover:text-[#141413]",
        link: "text-[#D97757] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-12 rounded-xl px-8 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
