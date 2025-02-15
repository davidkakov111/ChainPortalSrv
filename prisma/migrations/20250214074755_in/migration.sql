-- CreateTable
CREATE TABLE "InProgressTransactions" (
    "id" SERIAL NOT NULL,
    "paymentTxSignature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InProgressTransactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InProgressTransactions_paymentTxSignature_key" ON "InProgressTransactions"("paymentTxSignature");
