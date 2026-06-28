"use client"

import ErrorBoundary from "@/components/ErrorBoundary"
import { HERO_CYCLING_WORDS } from "@/lib/product-content"
import { useTypewriter } from "react-simple-typewriter"

const longestHeroWord = HERO_CYCLING_WORDS.reduce(
  (longest, word) => (word.length > longest.length ? word : longest),
  "",
)

/** ms per character — lower is faster */
const HERO_TYPE_SPEED_MS = 48
const HERO_DELETE_SPEED_MS = 32
/** pause on full word before deleting */
const HERO_WORD_HOLD_MS = 2200

function HeroTitleContent() {
  const [word] = useTypewriter({
    words: [...HERO_CYCLING_WORDS],
    loop: true,
    typeSpeed: HERO_TYPE_SPEED_MS,
    deleteSpeed: HERO_DELETE_SPEED_MS,
    delaySpeed: HERO_WORD_HOLD_MS,
  })

  const displayWord = word || "distributed"

  return (
    <h1 className="text-4xl md:text-6xl lg:text-[4.5rem] font-extrabold text-white leading-[1.1] tracking-tight mb-6">
      Work tracking for<br />
      the{" "}
      <span className="inline-grid align-bottom text-center">
        <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-nowrap">
          {longestHeroWord}
        </span>
        <span className="col-start-1 row-start-1 flex w-full min-w-full items-center justify-center">
          <span className="inline-flex items-center">
            <span
              className="text-transparent bg-clip-text"
              style={{ backgroundImage: "linear-gradient(90deg, #c4b5fd, #93c5fd)" }}
            >
              {displayWord}
            </span>
            <span
              aria-hidden
              className="ml-px inline-block w-[3px] shrink-0 rounded-sm animate-pulse"
              style={{ height: "0.8em", background: "#c4b5fd" }}
            />
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
