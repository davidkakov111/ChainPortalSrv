import { Injectable } from '@nestjs/common';
import { blockchainFees, blockchainSymbols } from './types';
import { NftMetadata, TokenMetadata } from './interfaces';
import { SolanaService } from 'src/solana/solana/solana.service';
import { AppService } from 'src/app.service';
import { HelperService } from './helper/helper/helper.service';
import { PrismaService } from 'src/prisma/prisma/prisma.service';
import { MetaplexService } from 'src/solana/metaplex/metaplex.service';
import { EthereumService } from 'src/ethereum/ethereum/ethereum.service';
import { ThirdwebService } from 'src/ethereum/thirdweb/thirdweb.service';

// Job processor to run codes in background, independent of the client connection
@Injectable()
export class JobProcessor {

  constructor(
    private readonly appSrv: AppService,
    private readonly helperSrv: HelperService,
    private readonly solanaService: SolanaService,
    private readonly prismaService: PrismaService,
    private readonly metaplexSrv: MetaplexService,
    private readonly ethereumSrv: EthereumService,
    private readonly thirdwebSrv: ThirdwebService,
  ) {}

  // NFT minting job
  async handleNftMintingJob(
    wsClientEmit: (message: any) => void, 
    wsClientEmitError: (errorMessage: any) => void, 
    data: {bChainSymbol: blockchainSymbols, paymentTxSignature: string, NftMetadata: NftMetadata}
  ) {
    // Ensure the payment transaction wasn't used before
    const newPayment = await this.wsJobProcessorNewTransactionValidator(wsClientEmitError, data.paymentTxSignature);
    if (!newPayment) return;

    // Ensure the metadata is valid
    const metadataValidation = this.helperSrv.validateNFTMetadata(data.NftMetadata);
    if (!metadataValidation.success) {
      // Redirect the payment bc the metadata is invalid
      let redirect: {
        isValid: boolean;
        message?: string;
      };
      if (data.bChainSymbol === 'SOL') {
        redirect = await this.solanaService.redirectSolPayment(data.paymentTxSignature, 'NFT');
      } else if (data.bChainSymbol === 'ETH') {
        redirect = await this.ethereumSrv.redirectEthPayment(data.paymentTxSignature, 'NFT');
      } // TODO - Integrate other bchains later

      if (redirect.isValid) {
        wsClientEmitError({id: 0, errorMessage: `Provided NFT metadata is invalid: "${metadataValidation.error}" so your payment was redirected after deducting the estimated refund fee. Please try again.`});
      } else {
        wsClientEmitError({id: 0, errorMessage: `Provided NFT metadata is invalid: "${metadataValidation.error}". Your payment was redirected but maybe failed: "${redirect.message}". Please try again.`});
      } 
      return;
    }

    // Try to calculate the NFT mint fees, according to the metadata size
    const mintFees: blockchainFees | undefined = await this.wsJobProcessorNftMintFeesCalculator(wsClientEmitError, data);
    if (!mintFees) return;

    // Spread the logic by blockchains
    if (data.bChainSymbol === 'SOL') {
      try {
        // ------------------ Payment transaction validation ------------------
        const validation = await this.solanaService.validateSolPaymentTx(data.paymentTxSignature, mintFees.SOL, 'NFT');
        if (!validation.isValid) {wsClientEmitError({id: 0, errorMessage: validation.errorMessage}); return;}
        wsClientEmit({id: 0, txId: null});
        // ------------------ Payment transaction validation ------------------

        // ------------------ Metadata upload ---------------------------------
        const metadataUploadResult = await this.metaplexSrv.uploadNFTMetadataToArweave(data.NftMetadata, mintFees.SOL, data.paymentTxSignature);
        if (!metadataUploadResult.successful) {wsClientEmitError({id: 1, errorMessage: metadataUploadResult.uri}); return;}
        wsClientEmit({id: 1, txId: null});
        // ------------------ Metadata upload ---------------------------------
     
        // ------------------ Mint the NFT ------------------------------------
        const minted = await this.metaplexSrv.mintSolNFT(validation.senderPubkey, validation.recipientBalanceChange, metadataUploadResult.uri, 
          data.NftMetadata.title, data.NftMetadata.royalty, data.NftMetadata.attributes, mintFees.SOL, data.paymentTxSignature);
        if (!minted.successful) {wsClientEmitError({id: 2, errorMessage: minted.txId}); return;}
        wsClientEmit({id: 2, txId: minted.txId});
        // ------------------ Mint the NFT ------------------------------------
      } catch (error) {
        console.error('Solana NFT minting job failed:', error);
        wsClientEmitError({id: -1, errorMessage: 'Solana NFT minting failed. Please try again.'});
        return;
      }
    } else if (data.bChainSymbol === 'ETH') {
      try {
        // ------------------ Payment transaction validation ------------------
        const validation = await this.ethereumSrv.validateEthPaymentTx(data.paymentTxSignature, mintFees.ETH, 'NFT');
        if (!validation.isValid) {wsClientEmitError({id: 0, errorMessage: validation.errorMessage}); return;}
        wsClientEmit({id: 0, txId: null});
        // ------------------ Payment transaction validation ------------------

        // ------------------ Metadata upload ---------------------------------
        const metadataUploadResult = await this.thirdwebSrv.uploadNFTMetadataToIPFS(data.NftMetadata, data.paymentTxSignature);
        if (!metadataUploadResult.successful) {wsClientEmitError({id: 1, errorMessage: metadataUploadResult.url}); return;}
        wsClientEmit({id: 1, txId: null});
        // ------------------ Metadata upload ---------------------------------

        // ------------------ Mint the NFT ------------------------------------
        const minted = await this.thirdwebSrv.mintEthNFT(validation.senderPubkey, 
          validation.receivedEthAmount, metadataUploadResult.url, data.paymentTxSignature);
        if (!minted.successful) {wsClientEmitError({id: 2, errorMessage: minted.txId}); return;}
        wsClientEmit({id: 2, txId: minted.txId});
        // ------------------ Mint the NFT ------------------------------------
      } catch (error) {
        console.error('Ethereum NFT minting job failed:', error);
        wsClientEmitError({id: -1, errorMessage: 'Ethereum NFT minting failed. Please try again.'});
        return;
      }
    } else {
      // TODO - Add support for other blockchains later
      wsClientEmitError({id: 0, errorMessage: 'Unsupported blockchain for NFT minting. Please use a different blockchain'});
    }
  }

  // Token minting job
  async handleTokenMintingJob(
    wsClientEmit: (message: any) => void, 
    wsClientEmitError: (errorMessage: any) => void, 
    data: {bChainSymbol: blockchainSymbols, paymentTxSignature: string, TokenMetadata: TokenMetadata}
  ) {
    // Ensure the payment transaction wasn't used before
    const newPayment = await this.wsJobProcessorNewTransactionValidator(wsClientEmitError, data.paymentTxSignature);
    if (!newPayment) return;

    // Ensure the metadata is valid
    const metadataValidation = this.helperSrv.validateTokenMetadata(data.TokenMetadata);
    if (!metadataValidation.success) {
      // Redirect the payment bc the metadata is invalid
      let redirect: {
        isValid: boolean;
        message?: string;
      };
      if (data.bChainSymbol === 'SOL') {
        redirect = await this.solanaService.redirectSolPayment(data.paymentTxSignature, 'Token');
      } else if (data.bChainSymbol === 'ETH') {
        redirect = await this.ethereumSrv.redirectEthPayment(data.paymentTxSignature, 'Token');
      } // TODO - Integrate other bchains later

      if (redirect.isValid) {
        wsClientEmitError({id: 0, errorMessage: `Provided token metadata is invalid: "${metadataValidation.error}" so your payment was redirected after deducting the estimated refund fee. Please try again.`});
      } else {
        wsClientEmitError({id: 0, errorMessage: `Provided token metadata is invalid: "${metadataValidation.error}". Your payment was redirected but maybe failed: "${redirect.message}". Please try again.`});
      } 
      return;
    }

    // Try to calculate the Token mint fees, according to the metadata size
    const mintFees: blockchainFees | undefined = await this.wsJobProcessorTokenMintFeesCalculator(wsClientEmitError, data);
    if (!mintFees) return;

    // Spread the logic by blockchains
    if (data.bChainSymbol === 'SOL') {
      try {
        // ------------------ Payment transaction validation ------------------
        const validation = await this.solanaService.validateSolPaymentTx(data.paymentTxSignature, mintFees.SOL, 'Token');
        if (!validation.isValid) {wsClientEmitError({id: 0, errorMessage: validation.errorMessage}); return;}
        wsClientEmit({id: 0, txId: null});
        // ------------------ Payment transaction validation ------------------

        // ------------------ Token icon upload ---------------------------------
        const metadataUploadResult = await this.metaplexSrv.uploadTokenMetadataToArweave(data.TokenMetadata, mintFees.SOL, data.paymentTxSignature);      
        if (!metadataUploadResult.successful) {wsClientEmitError({id: 1, errorMessage: metadataUploadResult.uri}); return;}
        wsClientEmit({id: 1, txId: null});
        // ------------------ Token icon upload ---------------------------------

        // ------------------ Mint the tokens ------------------------------------
        const minted = await this.metaplexSrv.mintSolTokens(validation.senderPubkey, validation.recipientBalanceChange, metadataUploadResult.uri, 
          data.TokenMetadata, mintFees.SOL, data.paymentTxSignature);
        if (!minted.successful) {wsClientEmitError({id: 2, errorMessage: minted.txId}); return;}
        wsClientEmit({id: 2, txId: minted.txId});
        // ------------------ Mint the tokens ------------------------------------
      } catch (error) {
        console.error('Solana token minting job failed:', error);
        wsClientEmitError({id: -1, errorMessage: 'Solana token minting failed. Please try again.'});
        return;
      }
    } else if (data.bChainSymbol === 'ETH') {
      try {
        // ------------------ Payment transaction validation ------------------
        const validation = await this.ethereumSrv.validateEthPaymentTx(data.paymentTxSignature, mintFees.ETH, 'Token');
        if (!validation.isValid) {wsClientEmitError({id: 0, errorMessage: validation.errorMessage}); return;}
        wsClientEmit({id: 0, txId: null});
        // ------------------ Payment transaction validation ------------------

        // ------------------ Deploy token contract ---------------------------------
        const contractDeployResult = await this.thirdwebSrv.deployErc20TokenContract(data.TokenMetadata, data.paymentTxSignature);
        if (!contractDeployResult.successful) {wsClientEmitError({id: 1, errorMessage: contractDeployResult.contractAddress}); return;}
        wsClientEmit({id: 1, txId: null});
        // ------------------ Deploy token contract ---------------------------------

        // ------------------ Mint the tokens ------------------------------------
        const minted = await this.thirdwebSrv.mintEthTokens(contractDeployResult.contractAddress, contractDeployResult.deployCostInEth,
          contractDeployResult.deployTx, validation.senderPubkey, validation.receivedEthAmount, data.TokenMetadata.supply, data.TokenMetadata.decimals, data.paymentTxSignature);
        if (!minted.successful) {wsClientEmitError({id: 2, errorMessage: minted.txId}); return;}
        wsClientEmit({id: 2, txId: minted.txId});
        // ------------------ Mint the tokens ------------------------------------
      } catch (error) {
        console.error('Ethereum token minting job failed: ', error);
        wsClientEmitError({id: -1, errorMessage: 'Ethereum token minting failed. Please try again.'});
        return;
      }
    } else {
      // TODO - Add support for other blockchains later
      wsClientEmitError({id: 0, errorMessage: 'Unsupported blockchain for token minting. Please use a different blockchain'});
    }
  }

  //? ------------------------------------ WS Job Processor Helpers ------------------------------------
  // Return ws response if the payment transaction signature is used before
  async wsJobProcessorNewTransactionValidator(wsClientEmitError: (errorMessage: any) => void, paymentTxSignature: string): Promise<boolean> {
    try {
      const isTxSignatureUsed = await this.prismaService.isTransactionSignatureUsed(paymentTxSignature);
      if (isTxSignatureUsed) {
        wsClientEmitError({id: 0, errorMessage: 'Your payment transaction has already been used. Please try again.'});
        return false;
      }
      const paymentInProgress = await this.prismaService.paymentInProgress(paymentTxSignature);
      if (paymentInProgress) {
        wsClientEmitError({id: 0, errorMessage: 'Your payment transaction is already being processed. Please try again.'});
        return false;
      }
      return true;
    } catch (error) {
      console.error('Failed to check if payment transaction (', paymentTxSignature, ') signature is used:', error);
      wsClientEmitError({id: 0, errorMessage: 'Failed to check if your payment transaction signature has been used before. Please try again.'});
      return false;
    }
  }

  // Return NFT mint fees, if coudn't calculate it, refund and return ws response
  async wsJobProcessorNftMintFeesCalculator(
    wsClientEmitError: (errorMessage: any) => void,
    data: {bChainSymbol: blockchainSymbols, paymentTxSignature: string, NftMetadata: NftMetadata}
  ): Promise<blockchainFees | undefined> {
    try {
      const metadataByteSize = this.helperSrv.calcMetadataByteSize(data.NftMetadata);
      if (typeof metadataByteSize === 'string') throw new Error(metadataByteSize);
      const mintFees = await this.appSrv.getMintFees("NFT", [data.bChainSymbol], metadataByteSize);
      return mintFees;
    } catch (error) {
      // Redirect the payment if some error occurs
      let redirect: {
        isValid: boolean, 
        message?: string
      };
      if (data.bChainSymbol === 'SOL') {
        redirect = await this.solanaService.redirectSolPayment(data.paymentTxSignature, 'NFT');
      } else if (data.bChainSymbol === 'ETH') {
        redirect = await this.ethereumSrv.redirectEthPayment(data.paymentTxSignature, 'NFT');
      } // TODO - Add other blockchains later

      if (redirect.isValid) {
        wsClientEmitError({id: 0, errorMessage: 'Unable to calculate the NFT minting fees so your payment was redirected after deducting the estimated refund fee. Please try again.'});
      } else {
        wsClientEmitError({id: 0, errorMessage: 'Unable to calculate the NFT minting fees. Your payment was redirected but maybe failed: "' + redirect.message + '". Please try again.'});
      }
      console.error('Failed to calculate NFT mint fees:', error);
      return;
    }
  }

  // Return token mint fees, if coudn't calculate it, refund and return ws response
  async wsJobProcessorTokenMintFeesCalculator(
    wsClientEmitError: (errorMessage: any) => void,
    data: {bChainSymbol: blockchainSymbols, paymentTxSignature: string, TokenMetadata: TokenMetadata}
  ): Promise<blockchainFees | undefined> {
    try {
      const metadataByteSize = this.helperSrv.calcMetadataByteSize({
        name: data.TokenMetadata.name, symbol: data.TokenMetadata.symbol, description: data.TokenMetadata.description,
        image: "https://gateway.irys.xyz/7ocJMYa6UPZcFPKiYtqsG6uJJzNmLNFHrtcDixXMRALZ", media: data.TokenMetadata.media
      });

      if (typeof metadataByteSize === 'string') throw new Error(metadataByteSize);
      const mintFees = await this.appSrv.getMintFees("Token", [data.bChainSymbol], metadataByteSize);
      return mintFees;
    } catch (error) {
      // Redirect the payment if some error occurs
      let redirect: {
        isValid: boolean, 
        message?: string
      };
      if (data.bChainSymbol === 'SOL') {
        redirect = await this.solanaService.redirectSolPayment(data.paymentTxSignature, 'Token');
      } else if (data.bChainSymbol === 'ETH') {
        redirect = await this.ethereumSrv.redirectEthPayment(data.paymentTxSignature, 'Token');
      } // TODO - Add other blockchains later

      if (redirect.isValid) {
        wsClientEmitError({id: 0, errorMessage: 'Unable to calculate the token minting fees so your payment was redirected after deducting the estimated refund fee. Please try again.'});
      } else {
        wsClientEmitError({id: 0, errorMessage: 'Unable to calculate the token minting fees. Your payment was redirected but maybe failed: "' + redirect.message + '". Please try again.'});
      }
      console.error('Failed to calculate token mint fees:', error);
      return;
    }
  }
  //? ------------------------------------ WS Job Processor Helpers ------------------------------------
}
