/*
  Warnings:

  - A unique constraint covering the columns `[paymentTxSignature]` on the table `MintTxHistory` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "MintTxHistory_paymentTxSignature_key" ON "MintTxHistory"("paymentTxSignature");
