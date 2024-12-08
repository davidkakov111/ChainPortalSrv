/*
  Warnings:

  - A unique constraint covering the columns `[mainTxHistoryId]` on the table `MintTxHistory` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "MintTxHistory_mainTxHistoryId_key" ON "MintTxHistory"("mainTxHistoryId");
