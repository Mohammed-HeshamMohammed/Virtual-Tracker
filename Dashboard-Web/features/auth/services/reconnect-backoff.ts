const DELAYS_MS = [2_000, 5_000, 10_000, 30_000, 60_000] as const

export class ReconnectBackoff {
  private failures = 0

  nextDelay(): number {
    const delay = DELAYS_MS[Math.min(this.failures, DELAYS_MS.length - 1)]
    this.failures += 1
    return delay
  }

  reset(): void {
    this.failures = 0
  }
}
