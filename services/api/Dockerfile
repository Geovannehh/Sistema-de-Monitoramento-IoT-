FROM node:22-slim
WORKDIR /app/services/api
COPY services/api/package*.json ./
RUN npm ci
COPY services/api ./
COPY shared /app/shared
RUN npm run build
EXPOSE 8000
CMD ["npm","start"]
