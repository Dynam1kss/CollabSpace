# збірка: ставимо залежності всього воркспейсу й збираємо клієнта. shared —
# сирий typescript без власного кроку збірки (журнал 10.09), тому його просто
# копіюємо: він потрібен і vite-збірці клієнта, і серверу під час роботи
FROM node:20-bookworm AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY client/package.json client/
COPY server/package.json server/
COPY shared/package.json shared/
RUN npm ci

COPY shared/ shared/
COPY server/ server/
COPY client/ client/

RUN npx prisma generate --schema server/prisma/schema.prisma
RUN npm run build -w client

# openssl — для рушія prisma, в slim-образі його нема
FROM node:20-bookworm-slim
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# node_modules беремо зі стадії збірки разом із символьними посиланнями
# воркспейсу (node_modules/shared → ../shared), тому shared і server мусять
# лягти на ті самі відносні шляхи
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json /app/tsconfig.base.json ./
COPY --from=build /app/shared shared
COPY --from=build /app/server server
COPY --from=build /app/client/package.json client/package.json
COPY --from=build /app/client/dist client/dist

ENV NODE_ENV=production
WORKDIR /app/server
EXPOSE 3000
# через sh, а не напряму: біт виконання з windows-репозиторію в образ не доїде
CMD ["sh", "docker-entrypoint.sh"]
