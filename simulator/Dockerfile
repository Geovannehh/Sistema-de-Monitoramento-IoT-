FROM node:22-slim
WORKDIR /app/simulator
COPY simulator/package*.json ./
RUN npm ci
COPY simulator ./
COPY shared /app/shared
RUN npm run build
CMD ["npm","start"]
