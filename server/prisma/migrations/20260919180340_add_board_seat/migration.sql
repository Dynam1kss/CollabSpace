-- CreateTable
CREATE TABLE "BoardSeat" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardSeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BoardSeat_boardId_userId_key" ON "BoardSeat"("boardId", "userId");

-- AddForeignKey
ALTER TABLE "BoardSeat" ADD CONSTRAINT "BoardSeat_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardSeat" ADD CONSTRAINT "BoardSeat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
