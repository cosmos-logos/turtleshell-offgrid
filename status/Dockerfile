FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY server.js .
COPY web/ ./web/
EXPOSE 717 718
CMD ["node", "server.js"]
