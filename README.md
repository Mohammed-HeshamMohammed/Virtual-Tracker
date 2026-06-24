# Virtual-Tracker

Virtual-Tracker is a multi-app workspace for a tracker platform with a backend service, a dashboard web app, and a landing web experience.

## Projects

- Backend: Node.js-based API and service layer with Firebase integration, mail support, and WebSocket capabilities.
- Dashboard Web: Next.js dashboard application for managing the product experience.
- Landing Web: Next.js marketing/landing site.

## Tech Stack

- Backend: Node.js, Firebase Admin SDK, Zod, Nodemailer, WS
- Dashboard Web: Next.js 16, React 19, TypeScript, Tailwind CSS, Radix UI
- Landing Web: Next.js 15, React 19, TypeScript, Tailwind CSS

## Getting Started

### 1. Backend

```bash
cd Backend
npm install
npm run dev
```

### 2. Dashboard Web

```bash
cd "Dashboard Web"
npm install
npm run dev
```

### 3. Landing Web

```bash
cd "Landing Web"
npm install
npm run dev
```

## Environment Notes

Local configuration files such as Firebase credentials and environment-specific settings are expected in the relevant app folders. Keep secret files out of version control.

## Project Structure

```text
Backend/
Dashboard Web/
Landing Web/
```

## Notes

- Use the app-specific package.json files for scripts and dependencies.
- The dashboard app includes additional utilities such as type checking and a cleanup script for local Next.js artifacts.
