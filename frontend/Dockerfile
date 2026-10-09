FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build:portable
FROM nginx:alpine
COPY frontend/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist-portable /usr/share/nginx/html
EXPOSE 80
