-- власника дошки визначає лише Board.ownerId, рядок OWNER у BoardMember ніколи не створюється
BEGIN;
CREATE TYPE "BoardRole_new" AS ENUM ('EDITOR', 'VIEWER');
ALTER TABLE "BoardMember" ALTER COLUMN "role" TYPE "BoardRole_new" USING ("role"::text::"BoardRole_new");
ALTER TYPE "BoardRole" RENAME TO "BoardRole_old";
ALTER TYPE "BoardRole_new" RENAME TO "BoardRole";
DROP TYPE "BoardRole_old";
COMMIT;
