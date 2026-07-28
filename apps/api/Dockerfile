FROM node:20-slim AS build
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
COPY apps/api ./apps/api
RUN npm install
RUN npm run build --workspace=@xlnc/shared \
 && npm run build --workspace=@xlnc/database \
 && npm run build --workspace=@xlnc/hostify-adapter \
 && npm run build --workspace=@xlnc/pricelabs-adapter \
 && npm run build --workspace=@xlnc/pricing-engine \
 && npm run build --workspace=@xlnc/api

FROM node:20-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo /repo
EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]
