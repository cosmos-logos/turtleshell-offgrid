FROM node:20-alpine
LABEL org.opencontainers.image.source=https://github.com/cosmos-logos/turtleshell-offgrid
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY server.js .
COPY web/ ./web/
EXPOSE 717 718
CMD ["node", "server.js"]
