"use client"

import { useState, useEffect } from "react"
import ErrorBoundary from "@/components/ErrorBoundary"
import { HERO_CYCLING_WORDS } from "@/lib/product-content"

const longestHeroWord = HERO_CYCLING_WORDS.reduce(
  (longest, word) => (word.length > longest.length ? word : longest),
  "",
)

function HeroTitleContent() {
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<"ENTERED" | "EXITING" | "ENTERING">("ENTERED")

  useEffect(() => {
    const timer = setInterval(() => {
      setPhase("EXITING")
      setTimeout(() => {
        setIndex((i) => (i + 1) % HERO_CYCLING_WORDS.length)
        setPhase("ENTERING")
        // Short tick to allow DOM to apply entering state before transition
        setTimeout(() => {
          setPhase("ENTERED")
        }, 50)
      }, 500) // Duration of exit animation
    }, 4000) // Total time per word

    return () => clearInterval(timer)
  }, [])

  const displayWord = HERO_CYCLING_WORDS[index]

  let transitionClass = "transition-all duration-500 ease-in-out"
  let transformClass = ""

  if (phase === "ENTERED") {
    transformClass = "opacity-100 translate-y-0"
  } else if (phase === "EXITING") {
    transformClass = "opacity-0 -translate-y-8"
  } else if (phase === "ENTERING") {
    transitionClass = ""
    transformClass = "opacity-0 translate-y-8"
  }

  return (
    <h1 className="text-4xl md:text-6xl lg:text-[4.5rem] font-extrabold text-white leading-[1.1] tracking-tight mb-6">
      Work tracking for<br />
      the{" "}
      <span className="inline-grid align-bottom text-center">
        <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-nowrap">
          {longestHeroWord}
        </span>
        <span className="col-start-1 row-start-1 flex w-full min-w-full items-center justify-center">
          <span
            className={`inline-block ${transitionClass} ${transformClass} text-transparent bg-clip-text`}
            style={{ backgroundImage: "linear-gradient(90deg, #c4b5fd, #93c5fd)" }}
          >
            {displayWord}
          </span>
        </span>
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
