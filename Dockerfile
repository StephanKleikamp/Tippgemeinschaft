# Tippgemeinschaft: kleiner Express-Server, der die App ausliefert und Tippschein, Ziehungen und
# Abrechnung in SQLite unter /data speichert (in Coolify ein dauerhaftes Volume). Kein Build-Schritt.
FROM node:24-alpine
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY public ./public
# Der Server läuft ohne Root-Rechte
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
