-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('PENDING', 'ACCEPTED');

-- наявні учасники вже мали доступ — лишаємо їм ACCEPTED, а дефолт для нових
-- рядків перемикаємо на PENDING окремим кроком
ALTER TABLE "BoardMember" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "status" "MemberStatus" NOT NULL DEFAULT 'ACCEPTED';

ALTER TABLE "BoardMember" ALTER COLUMN "status" SET DEFAULT 'PENDING';
