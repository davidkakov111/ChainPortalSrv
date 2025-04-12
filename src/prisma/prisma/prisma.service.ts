import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { feedback } from 'src/shared/interfaces';
import { assetType, blockchainSymbols, rewardTxsType } from 'src/shared/types';

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

  // (Unused) Get recently calculated minting fees based on assetType and blockchainSymbols
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

  // (Unused) Update or create a MintingFee record
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

  // Query all transaction history by pubkey
  async getAllTxHistory(pubkey: string) {
    return this.mainTxHistory.findMany({
      where: {paymentPubKey: pubkey},
      select: {
        id: true,
        assetType: true,
        operationType: true,
        blockchain: true,
        date: true,
      },
    });
  }

  // Get transaction details by tx id
  async getTxDetails(txId: number) {
    return await this.mainTxHistory.findUnique({
      where: { id: txId }, // Search for the main transaction by txId
      include: {
        MintTxHistories: true, 
        // TODO - Include associated bridge transaction history table later
      },
    });
  }

  // Save mint transaction history
  async saveMintTxHistory(params: {
    assetType: assetType,
    blockchain: blockchainSymbols,
    paymentPubKey: string,
    paymentAmount: number,
    expenseAmount: number,
    paymentTxSignature: string,
    rewardTxs: { txSignature: string, type: rewardTxsType }[]
  }) {
    // Use transaction to ensure both operations succeed or fail together
    return await this.$transaction(async (tx) => {
      // 1. Create main transaction record
      const mainTx = await tx.mainTxHistory.create({
        data: {
          operationType: 'mint',
          assetType: params.assetType,
          blockchain: params.blockchain,
          paymentPubKey: params.paymentPubKey,
          paymentAmount: params.paymentAmount,
          expenseAmount: params.expenseAmount,
        },
      });

      // 2. Create mint transaction record
      const mintTx = await tx.mintTxHistory.create({
        data: {
          mainTxHistoryId: mainTx.id,
          paymentTxSignature: params.paymentTxSignature,
          rewardTxs: params.rewardTxs,
        },
      });

      return { mainTx, mintTx };
    });
  }

  // Check if transaction signature exists in any relevant table
  async isTransactionSignatureUsed(txSignature: string): Promise<boolean> {
    // Check MintTxHistory table
    const mintTxExists = await this.mintTxHistory.findUnique({
      where: {paymentTxSignature: txSignature}
    });

    // TODO - add additional table checks later when implemented like bridgeTxHistory
    // const bridgeTxExists = await this.bridgeTxHistory.findUnique({
    //   where: {paymentTxSignature: txSignature},
    // });
    
    // Return true if found in any table
    return !!mintTxExists; // || !!bridgeTxExists
  }

  // Check if payment transaction is currently processing or not and update the table accordingly
  async paymentInProgress(paymentTxSignature: string) {
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1); // Get the timestamp of 24 hours ago
  
    const result = await this.$transaction(async (tx) => {
      // Delete records older than 1 day
      await tx.inProgressTransactions.deleteMany({
        where: { createdAt: { lt: oneDayAgo } },
      });
  
      // Check if the transaction signature already exists
      const existingTransaction = await tx.inProgressTransactions.findUnique({
        where: { paymentTxSignature },
      });
      if (existingTransaction) return true;
  
      // Otherwise, insert the transaction signature as "processing"
      await tx.inProgressTransactions.create({
        data: { paymentTxSignature },
      });
  
      return false;
    });
    return result;
  }

  // Save user feedback
  async saveFeedback(feedback: feedback): Promise<'Invalid rating'|'Successfully saved'> {
    if (feedback.rating > 5 || feedback.rating < 1) return 'Invalid rating';

    await this.feedback.create({data: feedback});
    return 'Successfully saved';
  }
}