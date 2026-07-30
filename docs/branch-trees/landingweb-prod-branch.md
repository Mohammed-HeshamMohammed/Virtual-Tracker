# LandingWeb-Prod Branch — Landing Website Frontend

> **Branch**: `LandingWeb-Prod`  
> **Latest Commit**: `528dbfe` — chore(landing-web): clean up development scripts from production package.json  
> **Tracks**: `origin/LandingWeb-Prod`  
> **Role**: Production-isolated deployment branch for the Landing-Web marketing site

---

## 1. Branch Purpose

The `LandingWeb-Prod` branch contains **only the Landing-Web service** — the public-facing marketing website for Virtual Tracker. It is stripped down to only the files needed for production deployment.

### What's Included
- `Landing-Web/` — Complete Next.js marketing site
- `.gitignore` — Repository-level ignore rules

### What's Excluded
- All markdown documentation
- `.env.example` files
- Auth-Backend, Dashboard-Backend, Dashboard-Web, Notify-backend, deploy/

---

## 2. Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | ^15.1.0 | React framework with App Router |
| React | ^19.0.0 | UI library |
| TailwindCSS | ^4.0.0 | Utility-first CSS |
| PostCSS | 8.5.10 | CSS processing |
| TypeScript | 5.8.2 | Type safety |
| react-simple-typewriter | ^5.0.1 | Hero section typewriter animation |

---

## 3. Site Architecture

```
Landing-Web/
├── .dockerignore             # Docker build exclusions
├── .npmrc                    # npm configuration
├── Dockerfile                # Multi-stage production build
├── index.js                  # Standalone server entry (port binding)
├── next.config.mjs           # Next.js configuration
├── nixpacks.toml             # Coolify build config
├── package.json              # Dependencies & scripts
├── postcss.config.mjs        # PostCSS/Tailwind configuration
├── scripts/
│   └── build.mjs             # Custom build script
├── public/
│   ├── apple-icon.png        # Apple touch icon
│   ├── icon.svg              # SVG favicon
│   ├── llms.txt              # LLM-readable site summary
│   ├── llms-full.txt         # Full LLM context document
│   ├── manifest.webmanifest  # PWA manifest
│   ├── robots.txt            # Search engine directives
│   ├── sitemap.xml           # Static sitemap
│   ├── stopwatch-black.png   # Brand icon (light theme)
│   └── stopwatch-green.png   # Brand icon (dark theme)
├── src/
│   ├── app/                  # Next.js App Router pages
│   ├── components/           # Shared components
│   ├── features/             # Feature-organized modules
│   ├── layout/               # Layout components
│   ├── lib/                  # Utility libraries
│   ├── sections/             # Landing page sections
│   └── styles/
│       └── globals.css       # Global stylesheet
└── tsconfig.json
```

---

## 4. Pages & Routes

| Route | File | Description |
|-------|------|-------------|
| `/` | `app/page.tsx` | Main landing page with hero, features, stats, testimonials, industries, trust, CTA |
| `/about` | `app/about/page.tsx` | Company information and mission |
| `/features` | `app/features/page.tsx` | Detailed feature showcase |
| `/pricing` | `app/pricing/page.tsx` | Plan comparison and pricing |
| `/solutions` | `app/solutions/page.tsx` | Industry-specific solutions |
| `/demo` | `app/demo/page.tsx` | Demo request page |
| `/contact` | `app/contact/page.tsx` | Contact form |
| `/blog` | `app/blog/page.tsx` | Blog listing page |
| `/blog/[slug]` | `app/blog/[slug]/page.tsx` | Individual blog post |
| `/resources` | `app/resources/page.tsx` | Guides and resources |
| `/sign-in` | `app/sign-in/page.tsx` | Redirect to dashboard sign-in |
| `/[...slug]` | `app/[...slug]/page.tsx` | Catch-all for unmatched routes |

### Error & System Pages
| Route | File | Description |
|-------|------|-------------|
| — | `app/error.tsx` | Error boundary |
| — | `app/global-error.tsx` | Root error boundary |
| — | `app/not-found.tsx` | 404 page |

---

## 5. SEO Implementation

### Metadata (`app/layout.tsx`)
- **Title**: "Virtual Tracker - Precise Time Tracking & Workforce Productivity Suite"
- **Description**: Comprehensive meta description for search engines
- **Keywords**: time tracking, workforce productivity, employee monitoring, timesheets, remote team management, project tracking
- **Canonical URL**: `https://virtualtracker.com`

### Dynamic SEO Assets
| Asset | File | Purpose |
|-------|------|---------|
| Sitemap | `app/sitemap.ts` | Dynamic XML sitemap generation |
| Robots | `app/robots.ts` | Search engine crawl directives |
| RSS Feed | `app/feed.xml/route.ts` | Blog RSS feed |
| OG Image | `app/opengraph-image.tsx` | Dynamic Open Graph image generation |
| Twitter Image | `app/twitter-image.tsx` | Dynamic Twitter Card image |
| Manifest | `app/manifest.ts` | PWA web manifest |

### OpenGraph & Twitter Cards
- Full OpenGraph configuration (title, description, URL, images, locale, type)
- Twitter `summary_large_image` card
- Brand stopwatch icons for social sharing

### LLM-Readable Content
- `/llms.txt` — Concise LLM-readable site summary
- `/llms-full.txt` — Comprehensive LLM context document

---

## 6. Landing Page Sections

The main landing page (`/`) is composed of the following sections:

### Hero Section (`sections/HeroSection/`)
- **HeroTitle**: Main heading with brand messaging
- **HeroSubtitle**: Subtitle with value proposition
- **HeroTabs**: Feature category tabs
- **HeroSlides**: Animated content slides
- **Announcement**: Product announcement banner
- **EmailForm**: Email capture CTA form

### Feature Sections
| Section | Description |
|---------|-------------|
| **FeaturesSection** | Grid of product features with icons and descriptions |
| **StatsSection** | Key metrics and statistics display |
| **TestimonialsSection** | Customer testimonials and reviews |
| **IndustriesSection** | Industry-specific use case showcase |
| **TrustSection** | Trust badges, certifications, and social proof |
| **CtaDemoSection** | Demo request call-to-action |
| **FinalCtaSection** | Bottom-of-page conversion section |

### Shared Components
- **NavigationBar**: Site-wide navigation with responsive menu
- **Footer**: Site footer with links, social, and legal
- **PageIntro**: Reusable page introduction component
- **PageShell**: Page layout wrapper
- **SafeSection**: Error-boundary wrapped section
- **ErrorBoundary**: Client-side error catching
- **AppCtaLink**: Dashboard redirect button

---

## 7. Component Architecture

### Feature-Based Organization
```
features/
├── blog/
│   ├── components/
│   │   ├── BlogListView.tsx    # Blog listing grid
│   │   └── BlogPostView.tsx    # Individual post render
│   └── index.ts
├── landing/
│   ├── components/
│   │   ├── CtaDemoSection.tsx
│   │   ├── FeaturesSection.tsx
│   │   ├── FinalCtaSection.tsx
│   │   ├── HeroSection.tsx
│   │   ├── IndustriesSection.tsx
│   │   ├── StatsSection.tsx
│   │   ├── TestimonialsSection.tsx
│   │   ├── TrustSection.tsx
│   │   └── index.ts
│   └── index.tsx
└── shared/
    ├── components/
    │   ├── FinalCtaSection.tsx
    │   ├── Footer.tsx
    │   └── NavigationBar.tsx
    └── index.ts
```

### Utility Libraries
| File | Purpose |
|------|---------|
| `lib/product-content.ts` | Product copy, feature lists, pricing data |
| `lib/safe.ts` | Safe wrapper utilities |
| `lib/site-urls.ts` | URL constants and builders |

---

## 8. Deployment

### Docker Build
- **Multi-stage** Dockerfile with Next.js standalone output
- **Port**: 3001 (configurable via `PORT` env)
- **HOSTNAME**: `0.0.0.0` for container binding

### Nixpacks (Coolify)
- Auto-detected via `nixpacks.toml`
- Installs `curl` for health check support

### Health Check
- Node.js script calls `http://127.0.0.1:3001` every 30s
- Start period: 60s (allows for Next.js cold start)

### Build Scripts
| Script | Command | Purpose |
|--------|---------|---------|
| `build` | `node scripts/build.mjs` | Production build |
| `start` | `node index.js` | Start standalone server |

---

## 9. Branch Evolution (Commit History)

| SHA | Message |
|-----|---------|
| `528dbfe` | chore(landing-web): clean up development scripts from production package.json |
| `b919de7` | chore(landing): sync .dockerignore from main |
| `24a57ad` | chore(landing): apply stopwatch brand icons configuration |
| `5c71be3` | chore: remove all markdown files |
| `8f97f8e` | fix(landing): copy static and public assets into standalone output |
| `70aec83` | fix(landing): bind Next standalone server to 0.0.0.0 instead of Docker HOSTNAME |
| `22fa5a2` | chore(nixpacks): restore nodejs to setup phase along with curl |
| `60448d9` | chore(landing): remove all code-defined fallback ports and URLs |
| `e133d69` | chore(nixpacks): install curl for HTTP health check support |
| `21f8f75` | chore: remove .env.example from production branch and update .dockerignore |
| `fd78f06` | chore: sync Landing-Web updates from main |
| `7444de7` | chore: sync Landing-Web updates from main |
| `b3cddfd` | chore: align next.js standalone start scripts with auth-backend structure |
| `1c1b998` | Sync Landing-Web from main: build scripts, hero fixes, and remove legacy catch-all route |
| `bdebe23` | Sync Landing-Web from main with routing fixes, UI updates, and Docker deploy |
| `5d56577` | Rename Landing Web folder to Landing-Web for Coolify deployment path |
| `82b33b2` | LandingWeb-Prod: isolated Landing Web with Coolify Next.js production config |
