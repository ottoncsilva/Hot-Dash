FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

# As sessões ficam num volume: sem elas, todo deploy pediria o código do
# Telegram de novo — e pedir código demais é o caminho curto para o chip levar
# bloqueio.
VOLUME ["/data"]
ENV SESSIONS_DIR=/data

EXPOSE 8100

CMD ["node", "server.js"]
