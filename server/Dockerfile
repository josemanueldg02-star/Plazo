# Construir desde la raíz del repo:  docker build -f server/Dockerfile -t plazo-sync .
# Ejecutar endurecido:
#   docker run --read-only --cap-drop ALL --security-opt no-new-privileges \
#     --env-file .env -e HOST=0.0.0.0 -v plazo-data:/data -p 127.0.0.1:8787:8787 plazo-sync
FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 DATA_FILE=/data/plazo.json
WORKDIR /app
COPY package.json ./
COPY core/vault.js ./core/vault.js
COPY server/src ./server/src
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "server/src/index.js"]
