FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 8765

ENV PORT=8765
ENV HOST=0.0.0.0

CMD ["node", "server/server.js"]
