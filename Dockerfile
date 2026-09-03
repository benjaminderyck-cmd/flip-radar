FROM node:24-bookworm-slim
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
RUN npx playwright install --with-deps chromium
COPY --chown=node:node src ./src
COPY --chown=node:node sql ./sql
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node config ./config
USER node
EXPOSE 8080
CMD ["node", "src/server.mjs"]
