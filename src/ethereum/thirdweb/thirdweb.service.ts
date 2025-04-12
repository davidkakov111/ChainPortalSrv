import { Injectable } from '@nestjs/common';
import { createThirdwebClient, ThirdwebClient } from "thirdweb";
import { upload } from "thirdweb/storage";
import { ConfigService } from '@nestjs/config';
import { assetType } from 'src/shared/types';
import { EthereumService } from '../ethereum/ethereum.service';
import { cliEnv, NftMetadata } from 'src/shared/interfaces';
import { ChainOptions, defineChain } from "thirdweb/chains";
import { getContract } from "thirdweb/contract";
import { mintTo } from "thirdweb/extensions/erc721";
import { privateKeyToAccount } from "thirdweb/wallets";
import { EthereumHelpersService } from '../ethereum-helpers/ethereum-helpers.service';
import { sendAndConfirmTransaction } from "thirdweb";
import { deployERC721Contract, ERC721ContractType } from "thirdweb/deploys";
import { Account } from '@metaplex-foundation/umi';
import { formatEther } from 'ethers';
import { PrismaService } from 'src/prisma/prisma/prisma.service';

@Injectable()
export class ThirdwebService {
    thirdwebClient: ThirdwebClient;
    cliEnv: cliEnv;
    isMainnet: boolean;
    thirdwebNftContract: string;

    constructor(
        private readonly configSrv: ConfigService,
        private readonly ethereumSrv: EthereumService,
        private readonly ethereumHelpersSrv: EthereumHelpersService,
        private readonly prismaSrv: PrismaService,
    ) {
        // Get .env variables
        const strCliEnv = this.configSrv.get<string>('cli_environment');
        this.cliEnv = JSON.parse(strCliEnv) as cliEnv;
        this.isMainnet = this.cliEnv.blockchainNetworks.ethereum.selected === 'mainnet';
        this.thirdwebNftContract = this.configSrv.get<string>(this.isMainnet ? 'mainnet_thirdweb_nft_contract' : 'sepolia_thirdweb_nft_contract');
        
        // Create thirdweb client
        const clientId = this.configSrv.get<string>('thirdweb_clinet_id');
        const secretKey = this.configSrv.get<string>('thirdweb_secret_key');
        this.thirdwebClient = createThirdwebClient({clientId, secretKey});     
    }

    // Upload complete NFT metadata (file & metadata) to IPFS
    async uploadNFTMetadataToIPFS(metadataObject: NftMetadata, paymentTxSignature: string): Promise<{successful: boolean, url: string}> {
        const fileUploadResult = await this.uploadMediaToIPFS(metadataObject.media, paymentTxSignature, 'NFT');
        if (!fileUploadResult.successful) {return {successful: false, url: fileUploadResult.fileUrl}};
        
        const metadataUploadResult = await this.uploadMetadataObjToIPFS({
            name: metadataObject.title,
            description: metadataObject.description,
            image: fileUploadResult.fileUrl, 
            animation_url: fileUploadResult.fileUrl,
            model: fileUploadResult.fileUrl,
            ...(metadataObject.externalLink && { external_url: metadataObject.externalLink }),
            ...(metadataObject.attributes?.length && { attributes: metadataObject.attributes.map(({ type, value }) => ({trait_type: type, value}))}),
            ...(metadataObject.symbol && { symbol: metadataObject.symbol }),
            ...(metadataObject.creator && { creator: metadataObject.creator }),
            ...(metadataObject.isLimitedEdition && { isLimitedEdition: metadataObject.isLimitedEdition }),
            ...(metadataObject.totalEditions && { totalEditions: metadataObject.totalEditions }),
            ...(metadataObject.editionNumber && { editionNumber: metadataObject.editionNumber }),
            ...(metadataObject.royalty && { royalty: metadataObject.royalty, properties: {royalty: metadataObject.royalty}}),
            ...(metadataObject.tags?.length && { tags: metadataObject.tags }),
            ...(metadataObject.license && { license: metadataObject.license }),
            ...(metadataObject.creationTimestampToggle && { creationTimestamp: metadataObject.creationTimestamp }),
        }, paymentTxSignature, 'NFT');
        return {successful: metadataUploadResult.successful, url: metadataUploadResult.metadataUrl};
    }

    // Upload unit 8 array type media file to IPFS
    async uploadMediaToIPFS(media:  Uint8Array, paymentTxSignature: string, assetType: assetType): Promise<{successful: boolean, fileUrl: string}> {
        try {
            const mediaUrl = await upload({client: this.thirdwebClient, files: [media]});
            if (!mediaUrl) {throw new Error("Uploaded file URL is missing, even though there was no error.")};
            return {successful: true, fileUrl: mediaUrl.replace("ipfs://", "https://ipfs.io/ipfs/")};
        } catch (error) {
            console.error(`Error uploading media file to ipfs via thirdweb: `, error);

            // Redirect the payment
            const redirect = await this.ethereumSrv.redirectEthPayment(paymentTxSignature, assetType);
            if (redirect.isValid) {
                return {successful: false, fileUrl: `Unable to upload media file to IPFS so your payment was redirected after deducting the estimated fee. Please try again.`};
            } else {
                return {successful: false, fileUrl: `Unable to upload media file to IPFS so your payment was redirected but maybe failed. Please try again.`};
            }
        }
    }

    // Upload metadata object to IPFS
    async uploadMetadataObjToIPFS(metadata: any, paymentTxSignature: string, assetType: assetType): Promise<{successful: boolean, metadataUrl: string}> {
        try {
            const metadataUrl = await upload({client: this.thirdwebClient,
                files: [{name: "metadata.json", data: JSON.stringify(metadata)}]
            });
            if (!metadataUrl) {throw new Error("Uploaded metadata URL is missing, even though there was no error.")}
            return {successful: true, metadataUrl: metadataUrl.replace("ipfs://", "https://ipfs.io/ipfs/")};
        } catch (error) {
            console.error(`Error uploading metadata (${JSON.stringify(metadata)}) to IPFS via thirdweb: `, error);

            // Redirect the payment
            const redirect = await this.ethereumSrv.redirectEthPayment(paymentTxSignature, assetType);
            if (redirect.isValid) {
                return {successful: false, metadataUrl: `Unable to upload metadata to IPFS so your payment was redirected after deducting the estimated fee. Please try again.`};
            } else {
                return {successful: false, metadataUrl: `Unable to upload metadata to IPFS so your payment was redirected but maybe failed. Please try again.`};
            }
        }
    }

    // Mint NFT on Ethereum blockchain with thirdweb
    async mintEthNFT(toPubkey: string, ethPaymentAmount: number, metadataUrl: string, paymentTxSignature: string): Promise<
        {successful: boolean, txId: number | string}> {
        try {
            // Get ChainPortal's thirdweb TokenERC721 NFT contract
            const contract = getContract({
                client: this.thirdwebClient,
                chain: defineChain({
                    id: this.isMainnet ? 1 : 11155111,
                    //? May need to provide some custom RPC if it gives error to often, example: rpc: `https://rpc.ankr.com/eth${this.isMainnet && '_sepolia'}`,
                    name: this.isMainnet ? 'Ethereum' : 'Sepolia',
                    nativeCurrency: {
                      name: "Ether",
                      symbol: "ETH",
                      decimals: 18,
                    }
                }),
                address: this.thirdwebNftContract
            });

            // Create account from private key
            const account = privateKeyToAccount({client: this.thirdwebClient,
                privateKey: this.ethereumHelpersSrv.getChainPortalWallet().privateKey
            });

            // Mint the NFT
            // TODO - May need to implement royalty fee for the NFT, bc the metadata royalty is not enough
            const transaction = mintTo({contract, to: toPubkey, nft: metadataUrl});
            const result = await sendAndConfirmTransaction({transaction, account});
            if (result.status !== 'success') throw new Error(`Ethereum NFT minting error, using Thirdweb: ${result}`);
            const mintCostInEth = parseFloat(formatEther(result.gasUsed * result.effectiveGasPrice));

            // Save the transaction to the db, bc it was successful
            const mintTxHistory = await this.prismaSrv.saveMintTxHistory({
                assetType: 'NFT',
                blockchain: 'ETH',
                paymentPubKey: toPubkey,
                paymentAmount: ethPaymentAmount,
                expenseAmount: mintCostInEth,
                paymentTxSignature: paymentTxSignature,
                rewardTxs: [{txSignature: result.transactionHash, type: 'mint'}]
            });
            // Return the mint transaction db history id
            return {successful: true, txId: mintTxHistory.mainTx.id};
        } catch (error) {
            console.error(`Error minting NFT on Ethereum via thirdweb: `, error);

            // Posible fee for nft minting in ETH
            let nftMintFee = parseFloat(this.configSrv.get<string>('ETH_NFT_MINT_FEE'));
    
            // Redirect the payment after deducting potential fees
            const redirect = await this.ethereumSrv.redirectEthPayment(paymentTxSignature, 'NFT', nftMintFee, [
                {txSignature: "NFT minting failed with Thirdweb on Ethereum blockchain.", type: 'mint'}]);
            if (redirect.isValid) {
                return {successful: false, txId: `Unable to mint NFT on Ethereum via Thirdweb so your payment was redirected after deducting the estimated fee(s). Please try again.`};
            } else {
                return {successful: false, txId: `Unable to mint NFT on Ethereum via Thirdweb so your payment was redirected but maybe failed. Please try again.`};
            }
        }
    }

    // Deploy thirdweb contract on Ethereum to mint NFTs
    async deployNftContract(chain: Readonly<ChainOptions & {rpc: string;}>, account: Account<any>, type: ERC721ContractType = "TokenERC721") {
        const contract = await deployERC721Contract({
            chain, client: this.thirdwebClient, account, type,
            params: {name: "ChainPortal", symbol: "CP", 
                description: "This contract allows minting of NFTs on the Ethereum blockchain, with each NFT being generated by users through the ChainPortal platform."}
        });
        return contract;
    }
}
