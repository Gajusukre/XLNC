FROM node:20-slim AS build
WORKDIR /repo/apps/web
COPY apps/web/package.json ./
RUN npm install
COPY apps/web ./
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /repo/apps/web
ENV NODE_ENV=production
COPY --from=build /repo/apps/web ./
EXPOSE 3000
CMD ["npm", "run", "start"]
