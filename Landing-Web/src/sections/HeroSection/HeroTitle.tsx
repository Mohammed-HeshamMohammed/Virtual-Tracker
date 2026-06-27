"use client"

import ErrorBoundary from "@/components/ErrorBoundary"
import { HERO_CYCLING_WORDS } from "@/lib/product-content"
import { useTypewriter } from "react-simple-typewriter"

function HeroTitleContent() {
  const [word] = useTypewriter({
    words: [...HERO_CYCLING_WORDS],
    loop: true,
    typeSpeed: 80,
    deleteSpeed: 50,
    delaySpeed: 1800,
  })

  return (
    <h1 className="text-4xl md:text-6xl lg:text-[4.5rem] font-extrabold text-white leading-[1.1] tracking-tight mb-6">
      Work tracking for<br />
      the{" "}
      <span className="relative inline-block">
        <span className="text-transparent bg-clip-text" style={{ backgroundImage: "linear-gradient(90deg, #c4b5fd, #93c5fd)" }}>
          {word || "distributed"}
        </span>
        <span className="absolute -right-[3px] top-[10%] h-[80%] w-[3px] rounded-sm animate-pulse" style={{ background: "#c4b5fd" }} />
      </span>
      {" "}team
    </h1>
  )
}

function HeroTitleFallback() {
  return (
    <h1 className="text-4xl md:text-6xl lg:text-[4.5rem] font-extrabold text-white leading-[1.1] tracking-tight mb-6">
      Work tracking for distributed teams
    </h1>
  )
}

export default function HeroTitle() {
  return (
    <ErrorBoundary section="hero title" fallback={<HeroTitleFallback />}>
      <HeroTitleContent />
    </ErrorBoundary>
  )
}
