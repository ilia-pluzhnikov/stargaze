# Сборка: веб (vite) + CLI-бандл (esbuild), затем лёгкий рантайм.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:cli

FROM node:22-slim
ENV NODE_ENV=production \
    STARGAZE_STORE=/data/store.json
# /data создаём с владельцем node: именованный volume унаследует права
RUN mkdir /data && chown node:node /data
WORKDIR /app
COPY --from=build /app/dist-node/cli.js ./cli.js
COPY --from=build /app/dist ./public
USER node
VOLUME /data
EXPOSE 8643
HEALTHCHECK --interval=30s --timeout=5s \
  CMD node -e "fetch('http://127.0.0.1:8643/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# --host 0.0.0.0: наружу порт открывает docker -p; статику serve найдёт в ./public
CMD ["node", "cli.js", "serve", "--host", "0.0.0.0"]
