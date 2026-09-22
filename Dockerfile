# Node 24.21.0 / linux-amd64 image manifest verified 2026-09-22.
FROM node:24-bookworm-slim@sha256:5cbc7caba8c2c0f0bca675d1b61b9f2857e1cf1853c6164ee9dd409501a936e7 AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web ./web
RUN npm run build
COPY server ./server
COPY config ./config
COPY db ./db
COPY scripts/apply-schema.mjs ./scripts/apply-schema.mjs
RUN npm prune --omit=dev

FROM node:24-bookworm-slim@sha256:5cbc7caba8c2c0f0bca675d1b61b9f2857e1cf1853c6164ee9dd409501a936e7 AS runtime

ENV NODE_ENV=production
ENV PORT=3000
ENV UPLOAD_DIR=/var/lib/changqi/uploads
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/config ./config
COPY --from=build /app/db ./db
COPY --from=build /app/scripts/apply-schema.mjs ./scripts/apply-schema.mjs
COPY --from=build /app/web/dist ./web/dist
RUN mkdir -p /var/lib/changqi/uploads
EXPOSE 3000
CMD ["node", "server/index.js"]
