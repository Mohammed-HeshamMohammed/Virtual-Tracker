import { LOGO_MAX_CHARS } from "@/shared/pdf-core/options"

const MAX_FILE_BYTES = 3 * 1024 * 1024
/** Twice the 110 x 40 pt the documents give a logo, so it stays sharp when printed. */
const MAX_WIDTH = 440
const MAX_HEIGHT = 160

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("That file could not be read as an image."))
    }
    image.src = url
  })
}

/**
 * A logo file as a small PNG (or, if that is still large, JPEG) data URL the
 * PDF can carry - including to the server, for emailed and scheduled reports.
 * Scaled down, never up, and never stretched.
 */
export async function prepareLogo(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Use a JPEG, PNG or WebP image.")
  if (file.size > MAX_FILE_BYTES) throw new Error("That image is over 3 MB.")
  const image = await loadImage(file)
  const scale = Math.min(1, MAX_WIDTH / image.naturalWidth, MAX_HEIGHT / image.naturalHeight)
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) throw new Error("This browser could not prepare the image.")
  context.drawImage(image, 0, 0, width, height)

  const png = canvas.toDataURL("image/png")
  if (png.length <= LOGO_MAX_CHARS) return png

  // Too detailed for a PNG that small: a JPEG on white, which has no transparency to keep.
  context.globalCompositeOperation = "destination-over"
  context.fillStyle = "#ffffff"
  context.fillRect(0, 0, width, height)
  const jpeg = canvas.toDataURL("image/jpeg", 0.85)
  if (jpeg.length <= LOGO_MAX_CHARS) return jpeg
  throw new Error("That image is too detailed to use as a logo. Try a simpler or smaller one.")
}
