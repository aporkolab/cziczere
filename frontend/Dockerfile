FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY vendor/ ./vendor/
RUN npm ci --no-audit --no-fund
COPY angular.json tsconfig*.json ./
COPY src/ ./src/
RUN npm run build -- --configuration=production,self-hosted

FROM nginx:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/frontend/ /usr/share/nginx/html/
EXPOSE 8080
