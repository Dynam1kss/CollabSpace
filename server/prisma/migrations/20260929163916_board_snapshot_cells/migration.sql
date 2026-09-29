-- CreateTable
CREATE TABLE "BoardSnapshotCell" (
    "boardId" TEXT NOT NULL,
    "cell" TEXT NOT NULL,
    "state" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardSnapshotCell_pkey" PRIMARY KEY ("boardId","cell")
);

-- AddForeignKey
ALTER TABLE "BoardSnapshotCell" ADD CONSTRAINT "BoardSnapshotCell_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
