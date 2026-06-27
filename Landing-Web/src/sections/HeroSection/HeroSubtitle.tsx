"use client"

import { PRODUCT_DESCRIPTION } from "@/lib/product-content"

export default function HeroSubtitle() {
  return (
    <p className="text-white text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed" style={{ opacity: 0.85 }}>
      {PRODUCT_DESCRIPTION}
    </p>
  )
}
