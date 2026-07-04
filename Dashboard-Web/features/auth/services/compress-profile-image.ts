const MAX_DIMENSION = 512
/** Keep encoded bytes under 500 KB for Firestore document limits. */
export const TARGET_MAX_BYTES = 500 * 1024

const ALLOWED_INPUT_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"])

/** Resize/re-encode profile image before upload (max 500 KB). */
export async function prepareProfileImageForUpload(file: File): Promise<File> {
  const inputType = file.type.toLowerCase()
  if (!ALLOWED_INPUT_TYPES.has(inputType)) {
    throw new Error("Unsupported file type. Use JPEG, PNG, or WebP.")
  }

  const bitmap = await createImageBitmap(file)
  try {
    const longest = Math.max(bitmap.width, bitmap.height)
    const scale = longest > MAX_DIMENSION ? MAX_DIMENSION / longest : 1
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Could not prepare image for upload.")
    ctx.drawImage(bitmap, 0, 0, width, height)

    const outputType = inputType === "image/png" ? "image/png" : "image/jpeg"
    const qualities = outputType === "image/png" ? [undefined] : [0.88, 0.78, 0.68, 0.58, 0.48, 0.38]
    let bestBlob: Blob | null = null
    for (const quality of qualities) {
      const blob =
        quality === undefined
          ? await canvasToBlob(canvas, outputType)
          : await canvasToBlob(canvas, outputType, quality)
      if (!blob) continue
      bestBlob = blob
      if (blob.size <= TARGET_MAX_BYTES) break
    }
    if (!bestBlob) {
      throw new Error("Could not compress image below 500 KB. Try a smaller photo.")
    }
    if (bestBlob.size > TARGET_MAX_BYTES) {
      throw new Error("Image is still too large after compression (max 500 KB). Try a smaller photo.")
    }

    const ext = outputType === "image/png" ? "png" : "jpg"
    const baseName = file.name.replace(/\.[^.]+$/, "") || "avatar"
    return new File([bestBlob], `${baseName}.${ext}`, { type: outputType })
  } finally {
    bitmap.close()
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality)
  })
}
