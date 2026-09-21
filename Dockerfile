FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web ./web
RUN npm run build
COPY server ./server
COPY config ./config
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3000
ENV UPLOAD_DIR=/var/lib/changqi/uploads
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/config ./config
COPY --from=build /app/web/dist ./web/dist
RUN mkdir -p /var/lib/changqi/uploads
EXPOSE 3000
CMD ["node", "server/index.js"]
