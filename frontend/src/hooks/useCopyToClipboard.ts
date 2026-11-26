import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Manages copying text to the clipboard with a transient "copied" indicator ID,
 * clearing previous timers and cleaning up on unmount.
 */
export function useCopyToClipboard(resetDelayMs = 1500) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const copyToClipboard = useCallback(async (text: string, id: string) => {
    if (!text) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedId(id);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        setCopiedId(null);
        timerRef.current = null;
      }, resetDelayMs);
    } catch {
      // Ignore clipboard write errors in restricted webviews
    }
  }, [resetDelayMs]);

  return { copiedId, copyToClipboard };
}
