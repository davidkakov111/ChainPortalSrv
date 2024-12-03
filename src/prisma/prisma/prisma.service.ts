import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { assetType, blockchainSymbols } from 'src/shared/types';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect(); // Connect to the database
  }

  async onModuleDestroy() {
    await this.$disconnect(); // Disconnect from the database
  }

  // Function to get recently calculated minting fees based on assetType and blockchainSymbols
  async getMintingFees(assetType: assetType, blockchainSymbols: blockchainSymbols[]) {
    const twelveHoursAgo = new Date();
    twelveHoursAgo.setHours(twelveHoursAgo.getHours() - 12);

    return this.mintingFee.findMany({
      where: {
        assetType,
        bchainSymbol: {
          in: blockchainSymbols,
        },
        updatedAt: {
          gt: twelveHoursAgo, // Only fetch records with updatedAt newer than 12 hours ago
        },
      },
      select: {
        bchainSymbol: true,
        fee: true,
      },
    });
  }

  // Function to update or create a MintingFee record
  async upsertMintingFee(
    assetType: assetType,
    bchainSymbol: blockchainSymbols,
    fee: number
  ) {
    await this.mintingFee.upsert({
      where: {
        assetType_bchainSymbol: {
          assetType,
          bchainSymbol,
        },
      },
      update: {
        fee
      },
      create: {
        assetType,
        bchainSymbol,
        fee
      },
    });
  }
}