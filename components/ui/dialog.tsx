"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

const Dialog: React.FC<DialogProps> = ({ open, onOpenChange, children }) => {
  const [isOpen, setIsOpen] = React.useState(open || false);

  React.useEffect(() => {
    if (open !== undefined) {
      setIsOpen(open);
    }
  }, [open]);

  const handleOpenChange = (newOpen: boolean) => {
    setIsOpen(newOpen);
    onOpenChange?.(newOpen);
  };

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/80" onClick={() => handleOpenChange(false)} />
      )}
      {React.Children.map(children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<any>, {
              open: isOpen,
              onOpenChange: handleOpenChange,
            })
          : child
      )}
    </>
  );
};

const DialogContent: React.FC<{
  className?: string;
  children: React.ReactNode;
  onClose?: () => void;
}> = ({ className, children, onClose }) => {
  return (
    <div
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200",
        className
      )}
    >
      {children}
      <button
        onClick={onClose}
        className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
  );
};

const DialogHeader: React.FC<{
  className?: string;
  children: React.ReactNode;
}> = ({ className, children }) => {
  return (
    <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)}>
      {children}
    </div>
  );
};

const DialogFooter: React.FC<{
  className?: string;
  children: React.ReactNode;
}> = ({ className, children }) => {
  return (
    <div
      className={cn(
        "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
        className
      )}
    >
      {children}
    </div>
  );
};

const DialogTitle: React.FC<{
  className?: string;
  children: React.ReactNode;
}> = ({ className, children }) => {
  return (
    <h2
      className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    >
      {children}
    </h2>
  );
};

const DialogDescription: React.FC<{
  className?: string;
  children: React.ReactNode;
}> = ({ className, children }) => {
  return (
    <p className={cn("text-sm text-muted-foreground", className)}>{children}</p>
  );
};

export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
};
