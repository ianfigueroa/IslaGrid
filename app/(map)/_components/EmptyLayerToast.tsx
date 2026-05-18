"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

interface Props {
  /** When non-null, render the toast with this message. Pass null to hide. */
  message: string | null;
  /** Auto-dismiss delay in ms. Default 3500. */
  durationMs?: number;
  /** Called when the toast self-dismisses; parent should clear its message state. */
  onDismiss: () => void;
}

/**
 * Floating pill above the LayerPills toolbar. Used to surface
 * "you toggled this layer on but there's nothing to show right now" so the
 * user can tell the layer is working but quiet — important for Hurricane and
 * other rare layers where empty looks identical to broken.
 */
export function EmptyLayerToast({ message, durationMs = 3500, onDismiss }: Props) {
  // Re-trigger the timer whenever a fresh message arrives.
  const [internalMsg, setInternalMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!message) {
      setInternalMsg(null);
      return;
    }
    setInternalMsg(message);
    const t = window.setTimeout(() => {
      setInternalMsg(null);
      onDismiss();
    }, durationMs);
    return () => window.clearTimeout(t);
  }, [message, durationMs, onDismiss]);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-20 z-30 flex justify-center px-3">
      <AnimatePresence>
        {internalMsg ? (
          <motion.div
            key={internalMsg}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            role="status"
            aria-live="polite"
            className="pointer-events-auto rounded-full glass-strong px-4 py-2 text-[12px] text-text-2 shadow-md"
          >
            {internalMsg}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
