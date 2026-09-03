export function attachForwardWheelToDocument(el: HTMLElement): () => void {
  function onWheel(e: WheelEvent): void {
    e.preventDefault()
    const yMul = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1
    const xMul = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerWidth : 1
    window.scrollBy({ left: e.deltaX * xMul, top: e.deltaY * yMul, behavior: "auto" })
  }
  el.addEventListener("wheel", onWheel, { passive: false })
  return () => el.removeEventListener("wheel", onWheel)
}
