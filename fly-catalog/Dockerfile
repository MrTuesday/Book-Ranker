FROM node:20-slim

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY server.js credential-order.js clean-series.cjs clean-series-step2.cjs ./

ENV PORT=8080
ENV DB_PATH=/data/openlibrary.db

EXPOSE 8080

CMD ["node", "server.js"]
