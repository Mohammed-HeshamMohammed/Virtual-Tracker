import { ReactNode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

const CloseIcon = () => (
  <svg height="14" strokeLinejoin="round" viewBox="0 0 16 16" width="14" fill="currentColor">
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M12.4697 13.5303L13 14.0607L14.0607 13L13.5303 12.4697L9.06065 7.99999L13.5303 3.53032L14.0607 2.99999L13 1.93933L12.4697 2.46966L7.99999 6.93933L3.53032 2.46966L2.99999 1.93933L1.93933 2.99999L2.46966 3.53032L6.93933 7.99999L2.46966 12.4697L1.93933 13L2.99999 14.0607L3.53032 13.5303L7.99999 9.06065L12.4697 13.5303Z"
    />
  </svg>
);

const UndoIcon = () => (
  <svg height="14" strokeLinejoin="round" viewBox="0 0 16 16" width="14" fill="currentColor">
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M13.5 8C13.5 4.96643 11.0257 2.5 7.96452 2.5C5.42843 2.5 3.29365 4.19393 2.63724 6.5H5.25H6V8H5.25H0.75C0.335787 8 0 7.66421 0 7.25V2.75V2H1.5V2.75V5.23347C2.57851 2.74164 5.06835 1 7.96452 1C11.8461 1 15 4.13001 15 8C15 11.87 11.8461 15 7.96452 15C5.62368 15 3.54872 13.8617 2.27046 12.1122L1.828 11.5066L3.03915 10.6217L3.48161 11.2273C4.48831 12.6051 6.12055 13.5 7.96452 13.5C11.0257 13.5 13.5 11.0336 13.5 8Z"
    />
  </svg>
);

export type ToastType = "message" | "success" | "warning" | "error";

export type Toast = {
  id: number;
  text: string | ReactNode;
  measuredHeight?: number;
  timeout?: ReturnType<typeof setTimeout>;
  remaining?: number;
  start?: number;
  pause?: () => void;
  resume?: () => void;
  preserve?: boolean;
  action?: string;
  onAction?: () => void;
  onUndoAction?: () => void;
  type: ToastType;
};

let root: ReturnType<typeof createRoot> | null = null;
let toastId = 0;

export const toastStore = {
  toasts: [] as Toast[],
  listeners: new Set<() => void>(),

  add(
    text: string | ReactNode,
    type: ToastType,
    preserve?: boolean,
    action?: string,
    onAction?: () => void,
    onUndoAction?: () => void
  ) {
    const id = toastId++;

    const toast: Toast = {
      id,
      text,
      preserve,
      action,
      onAction,
      onUndoAction,
      type,
    };

    if (!toast.preserve) {
      toast.remaining = 4000;
      toast.start = Date.now();

      const close = () => {
        this.toasts = this.toasts.filter((t) => t.id !== id);
        this.notify();
      };

      toast.timeout = setTimeout(close, toast.remaining);

      toast.pause = () => {
        if (!toast.timeout) return;
        clearTimeout(toast.timeout);
        toast.timeout = undefined;
        toast.remaining! -= Date.now() - toast.start!;
      };

      toast.resume = () => {
        if (toast.timeout) return;
        toast.start = Date.now();
        toast.timeout = setTimeout(close, toast.remaining);
      };
    }

    this.toasts.push(toast);
    this.notify();
  },

  remove(id: number) {
    toastStore.toasts = toastStore.toasts.filter((t) => t.id !== id);
    toastStore.notify();
  },

  subscribe(listener: () => void) {
    toastStore.listeners.add(listener);
    return () => {
      toastStore.listeners.delete(listener);
    };
  },

  notify() {
    toastStore.listeners.forEach((fn) => fn());
  },
};

const ToastContainer = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [shownIds, setShownIds] = useState<number[]>([]);
  const [isHovered, setIsHovered] = useState<boolean>(false);

  const measureRef = (t: Toast) => (node: HTMLDivElement | null) => {
    if (node && t.measuredHeight == null) {
      t.measuredHeight = node.getBoundingClientRect().height;
      toastStore.notify();
    }
  };

  useEffect(() => {
    setToasts([...toastStore.toasts]);

    return toastStore.subscribe(() => {
      setToasts([...toastStore.toasts]);
    });
  }, []);

  useEffect(() => {
    const unseen = toasts.filter((t) => !shownIds.includes(t.id)).map((t) => t.id);
    if (unseen.length > 0) {
      requestAnimationFrame(() => {
        setShownIds((prev) => [...prev, ...unseen]);
      });
    }
  }, [toasts, shownIds]);

  const lastVisibleCount = 3;
  const lastVisibleStart = Math.max(0, toasts.length - lastVisibleCount);

  const getFinalTransform = (index: number, length: number) => {
    if (index === length - 1) {
      return "none";
    }
    const offset = length - 1 - index;
    let translateY = toasts[length - 1]?.measuredHeight || 60;
    for (let i = length - 1; i > index; i--) {
      if (isHovered) {
        translateY += (toasts[i - 1]?.measuredHeight || 60) + 8;
      } else {
        translateY += 16;
      }
    }
    const z = -offset;
    const scale = isHovered ? 1 : 1 - 0.05 * offset;
    return `translate3d(0, calc(100% - ${translateY}px), ${z}px) scale(${scale})`;
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
    toastStore.toasts.forEach((t) => t.pause?.());
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    toastStore.toasts.forEach((t) => t.resume?.());
  };

  const visibleToasts = toasts.slice(lastVisibleStart);
  const containerHeight = visibleToasts.reduce((acc, t) => {
    return acc + (t.measuredHeight ?? 60);
  }, 0);

  return (
    <div
      className="vt-toast-wrapper"
      style={{ height: containerHeight }}
    >
      <div
        className="vt-toast-inner"
        style={{ height: containerHeight }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {toasts.map((t, index) => {
          const isVisible = index >= lastVisibleStart;

          return (
            <div
              key={t.id}
              ref={measureRef(t)}
              className={`vt-toast-card ${t.type} ${isVisible ? "visible" : "hidden"}`}
              style={{
                transition: "all .35s cubic-bezier(.25,.75,.6,.98)",
                transform: shownIds.includes(t.id)
                  ? getFinalTransform(index, toasts.length)
                  : "translate3d(0, 100%, 150px) scale(1)",
                pointerEvents: isVisible ? "auto" : "none",
              }}
            >
              <div className="vt-toast-body">
                <div className="vt-toast-top">
                  <span className="vt-toast-text">{t.text}</span>
                  {!t.action && (
                    <div className="vt-toast-actions">
                      {t.onUndoAction && (
                        <button
                          type="button"
                          className="vt-toast-icon-btn"
                          title="Undo"
                          onClick={() => {
                            t.onUndoAction?.();
                            toastStore.remove(t.id);
                          }}
                        >
                          <UndoIcon />
                        </button>
                      )}
                      <button
                        type="button"
                        className="vt-toast-icon-btn"
                        title="Dismiss"
                        onClick={() => toastStore.remove(t.id)}
                      >
                        <CloseIcon />
                      </button>
                    </div>
                  )}
                </div>
                {t.action && (
                  <div className="vt-toast-actions" style={{ justifyContent: "flex-end", marginTop: 4 }}>
                    <button
                      type="button"
                      className="vt-toast-btn vt-toast-btn-secondary"
                      onClick={() => toastStore.remove(t.id)}
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      className="vt-toast-btn vt-toast-btn-primary"
                      onClick={() => {
                        t.onAction?.();
                        toastStore.remove(t.id);
                      }}
                    >
                      {t.action}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const mountContainer = () => {
  if (root) return;
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  root.render(<ToastContainer />);
};

export interface ToastMessageOptions {
  text: string | ReactNode;
  preserve?: boolean;
  action?: string;
  onAction?: () => void;
  onUndoAction?: () => void;
}

export const toast = {
  message: (text: string | ReactNode, options?: Omit<ToastMessageOptions, "text">) => {
    mountContainer();
    toastStore.add(text, "message", options?.preserve, options?.action, options?.onAction, options?.onUndoAction);
  },
  success: (text: string, preserve?: boolean) => {
    mountContainer();
    toastStore.add(text, "success", preserve);
  },
  warning: (text: string, preserve?: boolean) => {
    mountContainer();
    toastStore.add(text, "warning", preserve);
  },
  error: (text: string, preserve?: boolean) => {
    mountContainer();
    toastStore.add(text, "error", preserve);
  },
};

export const useToasts = () => {
  return {
    message: useCallback(({ text, preserve, action, onAction, onUndoAction }: ToastMessageOptions) => {
      mountContainer();
      toastStore.add(text, "message", preserve, action, onAction, onUndoAction);
    }, []),
    success: useCallback((text: string, preserve?: boolean) => {
      mountContainer();
      toastStore.add(text, "success", preserve);
    }, []),
    warning: useCallback((text: string, preserve?: boolean) => {
      mountContainer();
      toastStore.add(text, "warning", preserve);
    }, []),
    error: useCallback((text: string, preserve?: boolean) => {
      mountContainer();
      toastStore.add(text, "error", preserve);
    }, []),
  };
};
