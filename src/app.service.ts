import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cliEnv, feedback, transaction } from './shared/interfaces';
import { assetType, blockchainFees, blockchainSymbols, operationType } from './shared/types';
import { PrismaService } from './prisma/prisma/prisma.service';
import { MetaplexService } from './solana/metaplex/metaplex.service';
import { HelperService } from './shared/helper/helper/helper.service';
import { Decimal } from '@prisma/client/runtime/library';
import { SolanaHelpersService } from './solana/solana-helpers/solana-helpers.service';
import { EthereumHelpersService } from './ethereum/ethereum-helpers/ethereum-helpers.service';
import axios from 'axios';

@Injectable()
export class AppService {
  constructor(
    private readonly configSrv: ConfigService,
    private readonly prismaSrv: PrismaService,
    private readonly metaplexSrv: MetaplexService,
    private readonly helperSrv: HelperService,
    private readonly solHelpersSrv: SolanaHelpersService,
    private readonly ethHelpersSrv: EthereumHelpersService,
  ) {}

  // Return client environment variables
  getCliEnv(): any {
    const strCliEnv = this.configSrv.get<string>('cli_environment');
    const cliEnv = JSON.parse(strCliEnv);
    
    // Attach Chainportal pubkeys to the client environemnt variables 
    // SOL
    const solPubkey = this.solHelpersSrv.getChainPortalKeypair(null, cliEnv as cliEnv).publicKey;
    cliEnv.blockchainNetworks.solana.pubKey = solPubkey;
    // ETH
    const ethPubkey = this.ethHelpersSrv.getChainPortalWallet(null, cliEnv as cliEnv).address;
    cliEnv.blockchainNetworks.ethereum.pubKey = ethPubkey;
    
    // TODO - Attach another suported blockchain pubkeys later

    return cliEnv;
  }

  // Return  mint fees based on blockchain, asset type and metadata size
  async getMintFees(assetType: assetType, blockchainSymbols: blockchainSymbols[], metadataByteSize: number = 0): Promise<blockchainFees> {
    if (!["NFT", "Token"].includes(assetType) || !blockchainSymbols?.length) {
      throw new HttpException('Invalid request', HttpStatus.BAD_REQUEST);
    }

    // Remove possible duplicated bchain symbols
    blockchainSymbols = Array.from(new Set(blockchainSymbols));

    const result: blockchainFees = {};

    // -------------------------- Currently there is no need to store the fees in db --------------------------------
    // Asign to the result the existing 'fresh' fees from db
    // const dbBchainFees = await this.prismaSrv.getMintingFees(assetType, blockchainSymbols);
    // for (let i of dbBchainFees) {
    //   result[i.bchainSymbol] = Number(i.fee);
    //   blockchainSymbols = blockchainSymbols.filter(symbol => symbol !== i.bchainSymbol);
    // }
    // ---------------------------------------------------------------------------------------------------------------
    
    // Calculate the fees with ChainPortal fees
    for (let i of blockchainSymbols) {
      if (i === "SOL") {
        result.SOL = parseFloat(this.configSrv.get<string>(`CHAIN_PORTAL_SOL_${assetType.toUpperCase()}_MINT_FEE`));
        result.SOL += parseFloat(this.configSrv.get<string>(`SOL_${assetType.toUpperCase()}_MINT_FEE`));
        // await this.prismaSrv.upsertMintingFee(assetType, 'SOL', result.SOL);
      } else if (i === "ETH") {
        result.ETH = parseFloat(this.configSrv.get<string>(`CHAIN_PORTAL_ETH_${assetType.toUpperCase()}_MINT_FEE`));  
        result.ETH += parseFloat(this.configSrv.get<string>(`ETH_${assetType.toUpperCase()}_MINT_FEE`));
        if (assetType === 'Token') result.ETH += parseFloat(this.configSrv.get<string>(`ETH_TOKEN_CONTRACT_DEPLOY_FEE`));
        // await this.prismaSrv.upsertMintingFee(assetType, 'ETH', result.ETH);
      } // TODO - Need to add options for another suported bchains later
    }

    // Calculate & assign the metadata upload costs
    if (result.SOL) {
      result.SOL += await this.metaplexSrv.calcArweaveMetadataUploadFee(metadataByteSize);
    } else if (result.ETH) {
      // Uploading metadata to IPFS is currently free in ETH. In the future, there might be a small cost, but it can be ignored for now.
      result.ETH += 0;
    } // TODO - Need to add options for another suported bchains later

    // Round up the fees to 4 decimals
    for (const key in result) {
      if (result.hasOwnProperty(key) && result[key] !== undefined) {
        result[key as keyof blockchainFees] = this.helperSrv.roundUpToDecimals(result[key], 4);
      }
    }

    return result;
  }

  // Return all transaction history by pubkey
  async getAllTxHistory(pubkey: string) {
    if (!pubkey) throw new HttpException('Missing pubkey', HttpStatus.BAD_REQUEST);
    return await this.prismaSrv.getAllTxHistory(pubkey);
  }

  // Return transaction details by tx id
  async getTxDetails(txId: number): Promise<transaction> {
    if (!txId) throw new HttpException('Missing transaction id', HttpStatus.BAD_REQUEST);
    
    const txDetails = await this.prismaSrv.getTxDetails(txId);
    if (!txDetails) throw new HttpException('Transaction not found', HttpStatus.NOT_FOUND);

    // Modify the result to match the `transaction` interface
    return {
      id: txDetails.id,
      operationType: txDetails.operationType as operationType,
      assetType: txDetails.assetType as assetType,
      blockchain: txDetails.blockchain as blockchainSymbols,
      paymentPubKey: txDetails.paymentPubKey,
      paymentAmount: new Decimal(txDetails.paymentAmount).toNumber(), // Convert Decimal to number
      date: txDetails.date,
      MintTxHistories: txDetails.MintTxHistories.map((mintTx) => ({
        id: mintTx.id,
        mainTxHistoryId: mintTx.mainTxHistoryId,
        paymentTxSignature: mintTx.paymentTxSignature,
        rewardTxs: Array.isArray(mintTx.rewardTxs) // Safely parse the JSON if it’s an array
          ? mintTx.rewardTxs.map((reward: any) => ({
              txSignature: reward.txSignature,
              type: reward.type,
            }))
          : [],
      })),
    };
  }

  // Save feedback 
  async saveFeedback(feedbackData: feedback): Promise<any> {
    if (!feedbackData.rating || feedbackData.rating > 5 || feedbackData.rating < 1) throw new HttpException('The rating should be between 5 and 1.', HttpStatus.BAD_REQUEST);
    
    // Save the feedback to the db
    const result = await this.prismaSrv.saveFeedback({
      afterUse: feedbackData.afterUse ? true : false,
      feedback: feedbackData.feedback ? feedbackData.feedback : '',
      rating: Math.round(feedbackData.rating),
      ip: feedbackData.ip ? String(feedbackData.ip) : ''
    });
    
    if (result === 'Successfully saved') {
      return {message: "Thank you!"};
    } else {
      throw new HttpException('The rating should be between 5 and 1.', HttpStatus.BAD_REQUEST);
    }
  }

  // Solana proxy with api key
  async solanaProxy(body: any): Promise<any> {
    try {
      const endpoint = `https://${this.getCliEnv().blockchainNetworks.solana.selected}.helius-rpc.com/?api-key=${this.configSrv.get('helius_api_key')}`;
      const heliusResponse = await axios.post(endpoint, body);
      return heliusResponse.data;
    } catch (error) {
      throw new HttpException(
        `Solana proxy failed: ${error?.response?.data}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
