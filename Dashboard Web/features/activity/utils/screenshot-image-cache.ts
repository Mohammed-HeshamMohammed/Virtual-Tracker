import { fetchActivityScreenshotImage } from "@/features/activity/services/activity-api"

const imageCache = new Map<string, string>()
const inflight = new Map<string, Promise<string | null>>()

let activeLoads = 0
const MAX_CONCURRENT = 4
const waitQueue: Array<() => void> = []

function runNext(): void {
  if (activeLoads >= MAX_CONCURRENT || waitQueue.length === 0) return
  const next = waitQueue.shift()
  next?.()
}

function scheduleLoad<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = () => {
      activeLoads += 1
      fn()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          activeLoads -= 1
          runNext()
        })
    }
    if (activeLoads < MAX_CONCURRENT) start()
    else waitQueue.push(start)
  })
}

export function getCachedScreenshotImage(id: string): string | undefined {
  return imageCache.get(id)
}

export function clearScreenshotImageCache(): void {
  imageCache.clear()
  inflight.clear()
}

export async function loadScreenshotImage(id: string): Promise<string | null> {
  const cached = imageCache.get(id)
  if (cached) return cached

  const pending = inflight.get(id)
  if (pending) return pending

  const promise = scheduleLoad(() => fetchActivityScreenshotImage(id)).then((url) => {
    if (url) imageCache.set(id, url)
    inflight.delete(id)
    return url
  })
  inflight.set(id, promise)
  return promise
}
