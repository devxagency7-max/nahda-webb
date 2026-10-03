# syntax=docker/dockerfile:1

# ---- build ----------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Relative on purpose: the browser calls its own origin and nginx proxies /api/ to the backend.
# Vite inlines this at build time, so changing it means rebuilding the image.
ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# ---- runtime --------------------------------------------------------------------------
# Unprivileged variant: runs as non-root and listens on 8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine

# CA bundle for nginx to verify the backend's TLS certificate (proxy_ssl_verify on).
USER root
RUN apk add --no-cache ca-certificates
USER 101

# Rendered with envsubst into conf.d/default.conf on start (see the header of nginx.conf).
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

# Backend origin that /api/ is proxied to (no path, no trailing slash). Override at run time.
ENV API_UPSTREAM=https://srv1990155.hstgr.cloud

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
