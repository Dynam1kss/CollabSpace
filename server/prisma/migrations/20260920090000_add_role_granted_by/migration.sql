ALTER TABLE "BoardMember" ADD COLUMN "roleGrantedBy" TEXT;

-- наявним адміністраторам ставимо власника дошки: хто їх насправді підняв,
-- уже не дізнатись, а це найобережніше припущення — такого адміністратора
-- зможе зняти лише власник
UPDATE "BoardMember" m
SET "roleGrantedBy" = b."ownerId"
FROM "Board" b
WHERE b."id" = m."boardId" AND m."role" = 'ADMIN';
