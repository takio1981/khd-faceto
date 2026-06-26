# ===== Frontend build stage (Angular) =====
FROM node:22-alpine AS frontend-builder
WORKDIR /app
COPY frontend-ng/package*.json ./
RUN npm install
COPY frontend-ng ./
RUN npm run build

# ===== Backend build stage =====
FROM node:22-alpine AS builder
WORKDIR /app

# Install dependencies (with dev deps for tsc)
COPY backend/package*.json ./
RUN npm install

# Compile TypeScript
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

# ===== Runtime stage =====
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# tzdata so the TZ env var (e.g. Asia/Bangkok) resolves for Node + system time
RUN apk add --no-cache tzdata

# Install production dependencies only
COPY backend/package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy compiled backend
COPY --from=builder /app/dist ./dist

# Copy Thai font assets used for PDF report generation
COPY backend/assets ./assets

# Copy the built Angular app (served by Express)
COPY --from=frontend-builder /app/dist/frontend-ng/browser ./public

# Face image storage dir (also mounted as a volume in compose)
RUN mkdir -p /data/faces

EXPOSE 3000
CMD ["node", "dist/index.js"]
