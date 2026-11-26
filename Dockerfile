FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY src ./src
COPY index.js bootstrap.js ./

ENV NODE_ENV=production
ENV PORT=3003

EXPOSE 3003

USER node

CMD ["node", "bootstrap.js"]
