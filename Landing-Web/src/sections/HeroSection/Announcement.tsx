"use client"

import Link from "next/link"

export default function Announcement() {
  return (
    <div className="flex items-center justify-center mb-10">
      <div className="flex items-center gap-2 border border-white/20 rounded-full bg-white/5 px-1 py-0.5 text-xs text-white">
        <span className="bg-white/10 border border-white/20 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap">
          Trial client
        </span>
        <span className="whitespace-nowrap pl-0.5">Desktop agent for Windows & macOS is available</span>
        <Link href="/desktop-agent" className="learn-more">
          <span className="circle" aria-hidden="true">
            <span className="icon arrow" />
          </span>
          <span className="button-text">Agent setup</span>
        </Link>
        <style jsx>{`
          .learn-more {
            position: relative;
            display: inline-block;
            cursor: pointer;
            outline: none;
            border: 0;
            vertical-align: middle;
            background: transparent;
            padding: 0;
            font-size: inherit;
            font-family: inherit;
            width: 7rem;
            height: auto;
            flex-shrink: 0;
          }
          .circle {
            transition: all 0.45s cubic-bezier(0.65, 0, 0.076, 1);
            position: relative;
            display: block;
            margin: 0;
            width: 1.5rem;
            height: 1.5rem;
            background: #ffffff;
            border-radius: 1.625rem;
          }
          .circle .icon {
            transition: all 0.45s cubic-bezier(0.65, 0, 0.076, 1);
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-60%, -50%);
          }
          .circle .icon.arrow {
            width: 0.55rem;
            height: 0.1rem;
            background: none;
          }
          .circle .icon.arrow::before {
            position: absolute;
            content: "";
            top: -0.18rem;
            right: 0.04rem;
            width: 0.35rem;
            height: 0.35rem;
            border-top: 0.1rem solid #000;
            border-right: 0.1rem solid #000;
            transform: rotate(45deg);
            transition: all 0.45s cubic-bezier(0.65, 0, 0.076, 1);
          }
          .button-text {
            transition: all 0.45s cubic-bezier(0.65, 0, 0.076, 1);
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            padding: 0.3rem 0;
            margin: 0 0 0 1.1rem;
            color: #ffffff;
            font-weight: 700;
            line-height: 1.6;
            text-align: center;
            text-transform: uppercase;
            white-space: nowrap;
            font-size: 0.6rem;
            letter-spacing: 0.03em;
          }
          .learn-more:hover .circle {
            width: 100%;
            background: #fff;
          }
          .learn-more:hover .circle .icon {
            transform: translate(30%, -50%);
          }
          .learn-more:hover .circle .icon.arrow::before {
            border-top-color: #fff;
            border-right-color: #fff;
          }
          .learn-more:hover .button-text {
            color: #000;
          }
        `}</style>
      </div>
    </div>
  )
}
