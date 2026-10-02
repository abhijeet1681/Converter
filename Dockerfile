# ConvertHub production image (includes LibreOffice for Office -> PDF)
FROM node:20-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    libreoffice-writer libreoffice-calc libreoffice-impress \
    fonts-dejavu fonts-liberation fonts-noto-core \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY scripts ./scripts
RUN npm install --omit=dev --no-audit --no-fund
COPY . .

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    SOFFICE_PATH=/usr/bin/soffice

EXPOSE 3000
USER node
CMD ["node", "server.js"]
