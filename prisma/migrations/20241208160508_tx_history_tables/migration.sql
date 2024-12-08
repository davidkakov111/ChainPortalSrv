-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('mint', 'bridge');

-- CreateTable
CREATE TABLE "MainTxHistory" (
    "id" SERIAL NOT NULL,
    "operationType" "OperationType" NOT NULL,
    "assetType" "AssetType" NOT NULL,
    "blockchain" "Bchain" NOT NULL,
    "paymentPubKey" TEXT NOT NULL,
    "paymentAmount" DECIMAL(65,30) NOT NULL,
    "expenseAmount" DECIMAL(65,30) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MainTxHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MintTxHistory" (
    "id" SERIAL NOT NULL,
    "mainTxHistoryId" INTEGER NOT NULL,
    "paymentTxSignature" TEXT NOT NULL,
    "rewardTxs" JSONB NOT NULL,

    CONSTRAINT "MintTxHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MintTxHistory_mainTxHistoryId_idx" ON "MintTxHistory"("mainTxHistoryId");

-- AddForeignKey
ALTER TABLE "MintTxHistory" ADD CONSTRAINT "MintTxHistory_mainTxHistoryId_fkey" FOREIGN KEY ("mainTxHistoryId") REFERENCES "MainTxHistory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
