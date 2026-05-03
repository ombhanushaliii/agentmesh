import { cn } from "./utils"

interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  viewportClassName?: string
}

export function ScrollArea({ className, viewportClassName, children, ...props }: ScrollAreaProps) {
  return (
    <div className={cn("relative overflow-hidden", className)} {...props}>
      <div
        className={cn(
          "h-full w-full overflow-y-auto",
          "[&::-webkit-scrollbar]:w-1.5",
          "[&::-webkit-scrollbar-track]:bg-transparent",
          "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
          viewportClassName
        )}
      >
        {children}
      </div>
    </div>
  )
}
