-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('nft', 'token');

-- CreateEnum
CREATE TYPE "Bchain" AS ENUM ('ETH', 'SOL', 'BSC', 'MATIC', 'ADA', 'XTZ', 'AVAX', 'FLOW', 'FTM', 'ALGO');

-- CreateTable
CREATE TABLE "MintingFee" (
    "id" SERIAL NOT NULL,
    "assetType" "AssetType" NOT NULL,
    "bchainSymbol" "Bchain" NOT NULL,
    "fee" DECIMAL(65,30) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MintingFee_pkey" PRIMARY KEY ("id")
);
