FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293

# Timezone rules decide which calendar day a member's tracked hours land on,
# so stale ones silently misfile work. Two separate hazards on Alpine:
#
#   1. Alpine ships no tzdata at all, so /usr/share/zoneinfo does not exist and
#      musl quietly answers UTC for anything reading system local time - no
#      error, just the wrong answer.
#   2. Node's Intl (which is what this codebase actually uses for day
#      boundaries) reads ICU's *bundled* copy, frozen at the moment this
#      pinned image was built. tzdata changes several times a year on
#      government notice - Egypt restored DST in 2023, Lebanon moved its
#      switch with two days' warning - so a long-pinned image drifts.
#
# Installing tzdata fixes (1) outright. For (2), re-pin this base image
# periodically; that is the only thing that refreshes ICU's copy.
RUN apk add --no-cache tzdata

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=5713

EXPOSE 5713

# Drop root: the node image ships an unprivileged `node` user (uid 1000).
# COPY and `npm ci` run as root, so /app is chowned before the switch.
RUN chown -R node:node /app
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5713)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--use-system-ca", "index.js"]
