#!/bin/sh
set -e

# migrate deploy, а не migrate dev: у контейнері схему не вигадуємо, лише
# накатуємо вже наявні міграції. Без цього перший запуск на чистій базі
# падає на кожному запиті
../node_modules/.bin/prisma migrate deploy

# tsx, а не зібраний js: shared лежить сирим typescript, і окремого кроку
# збірки сервера в проєкті нема — той самий спосіб запуску, що й у розробці
exec node ../node_modules/tsx/dist/cli.mjs src/index.ts
