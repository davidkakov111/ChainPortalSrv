/*
  Warnings:

  - A unique constraint covering the columns `[assetType,bchainSymbol]` on the table `MintingFee` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "MintingFee_assetType_bchainSymbol_key" ON "MintingFee"("assetType", "bchainSymbol");
