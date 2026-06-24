/* eslint-disable react-doctor/only-export-components */
"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { AlertCircle, X } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { Button } from "@/shared/ui/button"

const alertVariants = cva(
  "flex w-full items-start gap-2 rounded-lg border shadow-sm [&_[data-slot=alert-close]]:shrink-0",
  {
    variants: {
      variant: {
        secondary: "",
        destructive: "",
        warning: "",
        info: "",
      },
      appearance: {
        solid: "",
        light: "",
        outline: "",
      },
      size: {
        md: "p-3.5 gap-2.5 text-sm [&>[data-slot=alert-icon]>svg]:size-5 *:data-slot=alert-icon:mt-0 [&_[data-slot=alert-close]]:mt-0.5",
        sm: "gap-2 rounded-md px-3 py-2.5 text-xs [&>[data-slot=alert-icon]>svg]:size-4 [&_[data-slot=alert-close]_svg]:size-3.5",
      },
    },
    compoundVariants: [
      {
        variant: "secondary",
        appearance: "light",
        className: "border-border bg-muted text-foreground",
      },
      {
        variant: "destructive",
        appearance: "light",
        className:
          "border-[color-mix(in_oklab,var(--destructive)_25%,transparent)] bg-[color-mix(in_oklab,var(--destructive)_8%,var(--background))] text-foreground [&_[data-slot=alert-icon]]:text-destructive",
      },
      {
        variant: "warning",
        appearance: "light",
        className:
          "border-amber-200 bg-amber-50 text-foreground dark:border-amber-900 dark:bg-amber-950/60 [&_[data-slot=alert-icon]]:text-amber-700 dark:[&_[data-slot=alert-icon]]:text-amber-400",
      },
      {
        variant: "info",
        appearance: "light",
        className:
          "border-violet-200 bg-violet-50 text-foreground dark:border-violet-900 dark:bg-violet-950/50 [&_[data-slot=alert-icon]]:text-violet-700 dark:[&_[data-slot=alert-icon]]:text-violet-300",
      },
      {
        variant: "destructive",
        appearance: "solid",
        className: "border-transparent bg-destructive text-white [&_[data-slot=alert-close]]:text-white/90",
      },
      {
        variant: "warning",
        appearance: "solid",
        className: "border-transparent bg-amber-500 text-amber-950 dark:bg-amber-400 dark:text-amber-950",
      },
      {
        variant: "info",
        appearance: "solid",
        className: "border-transparent bg-violet-600 text-white",
      },
    ],
    defaultVariants: {
      variant: "secondary",
      appearance: "light",
      size: "md",
    },
  },
)

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  close?: boolean
  onClose?: () => void
}

function Alert({ className, variant, size, appearance, close = false, onClose, children, ...props }: AlertProps) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant, size, appearance }), className)}
      {...props}
    >
      {children}
      {close ? (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onClose}
          aria-label="Dismiss"
          data-slot="alert-close"
          className="h-8 w-8 shrink-0 text-inherit hover:bg-black/10 dark:hover:bg-white/10"
        >
          <X className="size-4 opacity-70 hover:opacity-100" />
        </Button>
      ) : null}
    </div>
  )
}

function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="alert-title" className={cn("font-semibold leading-snug tracking-tight", className)} {...props} />
}

function AlertIcon({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="alert-icon" className={cn("mt-0.5 shrink-0", className)} {...props}>
      {children}
    </div>
  )
}

function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="alert-description" className={cn("text-sm leading-relaxed opacity-95 [&_p]:mb-2 [&_p]:leading-relaxed", className)} {...props} />
  )
}

function AlertContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="alert-content" className={cn("min-w-0 flex-1 space-y-1", className)} {...props} />
}

export type NotifyAlertTone = "error" | "warning" | "info"

export interface NotifyAlertProps {
  title: string
  description: string
  tone?: NotifyAlertTone
  onDismiss: () => void
  className?: string
}

/** Opinionated alert for bottom-right notifications */
export function NotifyAlert({ title, description, tone = "error", onDismiss, className }: NotifyAlertProps) {
  const variant = tone === "error" ? "destructive" : tone === "warning" ? "warning" : "info"
  return (
    <Alert variant={variant as "destructive" | "warning" | "info"} appearance="light" size="md" close onClose={onDismiss} className={className}>
      <AlertIcon>
        <AlertCircle className="size-5" aria-hidden />
      </AlertIcon>
      <AlertContent>
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription className="whitespace-pre-line">{description}</AlertDescription>
      </AlertContent>
    </Alert>
  )
}

export { Alert, AlertContent, AlertDescription, AlertIcon, AlertTitle, alertVariants }
