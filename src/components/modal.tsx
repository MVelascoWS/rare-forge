"use client";

import { useEffect, type ReactNode } from "react";

/**
 * Reusable modal shell used by the create-work form, Review, and Deliver flows.
 * Closes on backdrop click or Escape. Keep content inside lean and form-driven.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Dim + blur backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
      />
      {/* Overlay panel */}
      <div className="relative w-full max-w-md rounded-xl border border-border bg-overlay p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="rf-display text-lg text-t1">{title}</h2>
          <button
            onClick={onClose}
            className="text-t3 transition-colors hover:text-t1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
