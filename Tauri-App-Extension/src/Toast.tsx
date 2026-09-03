import { ReactNode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Icon, type IconName } from "./components/common/Icon";

export type ToastType = "message" | "success" | "warning" | "error";

const TYPE_ICON: Record<ToastType, IconName> = {
  success: "check",
  warning: "warn",
  error: "error",
  message: "info",
};

export type Toast = {
  id: number;
  text: string | ReactNode;
  detail?: string;
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
              <div className="vt-toast-main">
                <span className="vt-toast-icon">
                  <Icon name={TYPE_ICON[t.type]} />
                </span>

                <div className="vt-toast-body">
                  <div className="vt-toast-top">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="vt-toast-title">{t.text}</div>
                      {t.detail ? <div className="vt-toast-detail">{t.detail}</div> : null}
                    </div>
                    {!t.action && (
                      <div className="vt-toast-actions">
                        {t.onUndoAction && (
                          <button
                            type="button"
                            className="vt-toast-icon-btn"
                            title="Undo"
                            aria-label="Undo"
                            onClick={() => {
                              t.onUndoAction?.();
                              toastStore.remove(t.id);
                            }}
                          >
                            <Icon name="undo" />
                          </button>
                        )}
                        <button
                          type="button"
                          className="vt-toast-icon-btn"
                          title="Dismiss"
                          aria-label="Dismiss"
                          onClick={() => toastStore.remove(t.id)}
                        >
                          <Icon name="close" />
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

              {!t.preserve && t.remaining ? (
                <div className="vt-toast-progress">
                  <span style={{ animationDuration: `${t.remaining}ms` }} />
                </div>
              ) : null}
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
