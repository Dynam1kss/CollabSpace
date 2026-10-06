-- CreateTable
CREATE TABLE "BoardFile" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BoardFile_boardId_idx" ON "BoardFile"("boardId");

-- AddForeignKey
ALTER TABLE "BoardFile" ADD CONSTRAINT "BoardFile_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardFile" ADD CONSTRAINT "BoardFile_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
