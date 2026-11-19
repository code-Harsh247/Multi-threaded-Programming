# Stage 1: build the C simulation engine on Linux.
FROM debian:bookworm-slim AS engine
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc libc6-dev make \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY boating.c Makefile ./
RUN make

# Stage 2: the Node web server (same Debian release, so the same glibc).
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    BOATING_BIN=/app/boating \
    PORT=3000
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --omit=dev
COPY web/src ./src
COPY web/public ./public
COPY --from=engine /src/boating /app/boating
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
