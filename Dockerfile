# build stage — full toolchain for native deps + vite
FROM node:22 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# runtime — prod deps only (better-sqlite3/onnxruntime ship prebuilt binaries)
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

# all state lives here — mount it
VOLUME /app/data
EXPOSE 7777
# inside a container the bind must be reachable from the host's port map;
# the container boundary is the network boundary — do NOT publish this port publicly
CMD ["node", "dist/server/index.js", "--host", "0.0.0.0", "--i-understand-no-auth", "--data", "/app/data"]
