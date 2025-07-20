import { Injectable } from '@nestjs/common';
import { createThirdwebClient, prepareContractCall, ThirdwebClient } from "thirdweb";
import { upload } from "thirdweb/storage";
import { ConfigService } from '@nestjs/config';
import { assetType } from 'src/shared/types';
import { EthereumService } from '../ethereum/ethereum.service';
import { cliEnv, NftMetadata, TokenMetadata } from 'src/shared/interfaces';
import { ChainOptions, defineChain } from "thirdweb/chains";
import { getContract } from "thirdweb/contract";
import { mintTo } from "thirdweb/extensions/erc721";
import { privateKeyToAccount } from "thirdweb/wallets";
import { EthereumHelpersService } from '../ethereum-helpers/ethereum-helpers.service';
import { sendAndConfirmTransaction } from "thirdweb";
import { deployERC721Contract } from "thirdweb/deploys";
import { Account } from '@metaplex-foundation/umi';
import { formatEther, parseUnits } from 'ethers';
import { PrismaService } from 'src/prisma/prisma/prisma.service';
import { deployERC20Contract } from "thirdweb/deploys";

@Injectable()
export class ThirdwebService {
    thirdwebClient: ThirdwebClient;
    cliEnv: cliEnv;
    isMainnet: boolean;
    thirdwebNftContract: string;
    chain: Readonly<ChainOptions & {rpc: string;}>;
    account: Account<any>;

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
        // TODO - USE PAID ETH - I can or should make it paid? Or need new ones? - It seems for the first round for a few users it is enough for free just need to clean up the thirdweb storage pined files, but if a  i got a few dollar from the platform it is the time to pay for thsi also!
        const clientId = this.configSrv.get<string>('thirdweb_clinet_id');
        const secretKey = this.configSrv.get<string>('thirdweb_secret_key');
        this.thirdwebClient = createThirdwebClient({clientId, secretKey});    
        
        // Define the Ethereum chain and account for thirdweb
        this.chain = defineChain({
            id: this.isMainnet ? 1 : 11155111,
            // TODO - USE PAID ETH - Use paid plan for my alchemy account with this api key, if needed 
            rpc: `https://eth-${this.cliEnv.blockchainNetworks.ethereum.selected}.g.alchemy.com/v2/${this.configSrv.get('alchemy_api_key')}`,                
            name: this.isMainnet ? 'Ethereum' : 'Sepolia',
            nativeCurrency: {name: "Ether", symbol: "ETH", decimals: 18}
        });
        this.account = privateKeyToAccount({client: this.thirdwebClient,
            privateKey: this.ethereumHelpersSrv.getChainPortalWallet().privateKey
        });
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
                chain: this.chain,
                address: this.thirdwebNftContract
            });

            // Mint the NFT
            // TODO - May need to implement royalty fee for the NFT, bc the metadata royalty is not enough
            const transaction = mintTo({contract, to: toPubkey, nft: metadataUrl});
            const result = await sendAndConfirmTransaction({transaction, account: this.account});
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

    // Deploy erc20 ethereum token contract on Ethereum blockchain with thirdweb
    async deployErc20TokenContract(metadata: TokenMetadata, paymentTxSignature: string): Promise<
        {successful: boolean, contractAddress: string, deployCostInEth: number, deployTx: string}> {
        try {
            // Deploy token contract
            const contractAddress = await this.deployTokenContract(metadata);            
        
            // Get the exact contract deployment fee in ETH, or at least the estimated value from .env
            let deployCostInEth = parseFloat(this.configSrv.get<string>('ETH_TOKEN_CONTRACT_DEPLOY_FEE'));
            let deployTx = contractAddress;
            try {
                const contractLogs = await this.ethereumSrv.provider.getLogs({
                    address: contractAddress, fromBlock: 0, toBlock: "latest"});
                deployTx = contractLogs[0].transactionHash;
                const tx = await this.ethereumSrv.provider.getTransactionReceipt(deployTx);
                deployCostInEth = parseFloat(formatEther(tx.gasUsed * tx.gasPrice));
            } catch (error) {
                console.log('Couldn\'t calculate the exact ERC20 token contract deployment fee, so using the default value from .env due to this error:', error);
            }

            return {successful: true, contractAddress, deployCostInEth, deployTx};
        } catch (error) {
            console.error(`Error durring erc20 token contract deployment on Ethereum via thirdweb: `, error);

            // Posible fee for erc20 token contract deployment
            let tokenContractDeploymentFee = parseFloat(this.configSrv.get<string>('ETH_TOKEN_CONTRACT_DEPLOY_FEE'));
    
            // Redirect the payment after deducting potential fees
            const redirect = await this.ethereumSrv.redirectEthPayment(paymentTxSignature, 'Token', tokenContractDeploymentFee, [
                {txSignature: "ERC20 token contract deployment failed with Thirdweb on Ethereum blockchain.", type: 'contract deployment'}]);
            if (redirect.isValid) {
                return {successful: false, deployCostInEth: tokenContractDeploymentFee, deployTx: '', contractAddress: `Unable to deploy ERC20 token contract on Ethereum via Thirdweb, so your payment was redirected after deducting the estimated fee(s). Please try again.`};
            } else {
                return {successful: false, deployCostInEth: tokenContractDeploymentFee, deployTx: '', contractAddress: `Unable to deploy ERC20 token contract on Ethereum via Thirdweb, so your payment was redirected but maybe failed. Please try again.`};
            }
        }
    }

    // Mint tokens on Ethereum blockchain with predeployed thirdweb ERC20 token contract
    async mintEthTokens(contractAddress: string, ethContractDeployCost: number, contractDeployTx: string, toPubkey: string, ethPaymentAmount: number, 
        tokenSupply: number, tokenDecimals: number, paymentTxSignature: string): Promise<{successful: boolean, txId: number | string}> {
        try {
            // Get token contract         
            const contract = getContract({client: this.thirdwebClient, chain: this.chain, address: contractAddress});

            // Mint the tokens
            const transaction = prepareContractCall({
                contract, method: "function mintTo(address to, uint256 amount)",
                params: [toPubkey, parseUnits(String(tokenSupply), 18-tokenDecimals)], // TODO - The token decimals are not respected; I can only use 18 with the ERC20 Thirdweb contract.
            });
            const result = await sendAndConfirmTransaction({transaction, account: this.account});
            if (result.status !== 'success') throw new Error(`Ethereum ERC20 token minting error, using Thirdweb: ${result}`);
            const mintCostInEth = parseFloat(formatEther(result.gasUsed * result.effectiveGasPrice));

            // Save the transaction to the db, bc it was successful
            const mintTxHistory = await this.prismaSrv.saveMintTxHistory({
                assetType: 'Token',
                blockchain: 'ETH',
                paymentPubKey: toPubkey,
                paymentAmount: ethPaymentAmount,
                expenseAmount: ethContractDeployCost + mintCostInEth,
                paymentTxSignature: paymentTxSignature,
                rewardTxs: [
                    {txSignature: contractDeployTx, type: 'contract deployment'},
                    {txSignature: result.transactionHash, type: 'mint'}
                ]
            });
            // Return the mint transaction db history id
            return {successful: true, txId: mintTxHistory.mainTx.id};
        } catch (error) {
            console.error(`Error minting tokens on Ethereum via thirdweb: `, error);

            // Posible fee for token minting in ETH
            const tokenMintFee = parseFloat(this.configSrv.get<string>('ETH_TOKEN_MINT_FEE'));
    
            // Redirect the payment after deducting potential fees
            const redirect = await this.ethereumSrv.redirectEthPayment(paymentTxSignature, 'Token', ethContractDeployCost + tokenMintFee, [
                {txSignature: contractDeployTx, type: 'contract deployment'},
                {txSignature: "Token minting failed with Thirdweb on Ethereum blockchain.", type: 'mint'}]);
            if (redirect.isValid) {
                return {successful: false, txId: `Unable to mint tokens on Ethereum via Thirdweb so your payment was redirected after deducting the estimated fee(s). Please try again.`};
            } else {
                return {successful: false, txId: `Unable to mint tokens on Ethereum via Thirdweb so your payment was redirected but maybe failed. Please try again.`};
            }
        }
    }

    // Deploy thirdweb contract on Ethereum to mint NFTs
    async deployNftContract() {
        return await deployERC721Contract({
            chain: this.chain, client: this.thirdwebClient, account: this.account, type: "TokenERC721",
            params: {name: "ChainPortal", symbol: "CP", 
                description: "This contract allows NFT minting on the Ethereum blockchain, with each NFT being generated by users through the ChainPortal platform."}
        });
    }

    // Deploy thirdweb contract on Ethereum to mint tokens
    async deployTokenContract(metadata: TokenMetadata) {
        return await deployERC20Contract({
            chain: this.chain,
            account: this.account,
            type: "TokenERC20",
            client: this.thirdwebClient,
            params: {
              name: metadata.name,
              symbol: metadata.symbol,
              description: metadata.description,
              external_link: metadata.externalLink,
              image: metadata.media
            }
        });   
    }
}
