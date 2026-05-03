import { cn } from "./utils"

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "outline"
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset transition-colors",
        variant === "default" && "bg-foreground text-background ring-transparent",
        variant === "secondary" && "bg-muted text-muted-foreground ring-transparent",
        variant === "outline" && "bg-transparent text-foreground ring-border",
        className
      )}
      {...props}
    />
  )
}
