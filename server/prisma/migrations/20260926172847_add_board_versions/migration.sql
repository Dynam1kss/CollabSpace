-- CreateTable
CREATE TABLE "BoardVersion" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "state" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "label" TEXT,
    "isManual" BOOLEAN NOT NULL,

    CONSTRAINT "BoardVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BoardVersion_boardId_createdAt_idx" ON "BoardVersion"("boardId", "createdAt");

-- AddForeignKey
ALTER TABLE "BoardVersion" ADD CONSTRAINT "BoardVersion_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
