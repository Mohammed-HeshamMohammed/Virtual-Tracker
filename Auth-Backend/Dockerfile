FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY index.js ./
COPY src ./src

EXPOSE 3000

CMD ["node", "--use-system-ca", "index.js"]
