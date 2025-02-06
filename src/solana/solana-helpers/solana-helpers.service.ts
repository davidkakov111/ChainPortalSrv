import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { SuiteContext } from 'node:test';
import { cliEnv, NftMetadata, TokenMetadata } from 'src/shared/interfaces';

@Injectable()
export class SolanaHelpersService {
    
    constructor(private readonly configSrv: ConfigService) {}

    // Method to generate a new Solana wallet
    createWallet() {
        // Generate a new Keypair
        const keypair = Keypair.generate();

        // Get the private key in byte array
        const bytePrivateKey = keypair.secretKey;

        // Convert private key to base58 (e.g., for use with Phantom wallet)
        const base58PrivateKey = bs58.encode(bytePrivateKey);

        // Get the public key
        const publicKey = keypair.publicKey.toBase58();

        // Return the wallet details
        return {bytePrivateKey, base58PrivateKey, publicKey};
    }

    // Convert the base58 private key to Keypair and return it (The params are optional to speed up the process)
    getChainPortalKeypair(base58PrivateKey?: string, cliEnv?: cliEnv): Keypair {
        if (!base58PrivateKey) {
            if (!cliEnv) {
                // Get cli environment from environment variables if not provided
                const strCliEnv = this.configSrv.get<string>('cli_environment');
                cliEnv = JSON.parse(strCliEnv) as cliEnv;
            }
            
            // Get Chain Portal's solana private key from environment variables
            const PrivateKey = cliEnv.blockchainNetworks.solana.selected === "devnet" ? 'solanaDevBase58PrivateKey' : 'solanaBase58PrivateKey';
            base58PrivateKey = this.configSrv.get<string>(PrivateKey);
        }
        const privateKeyBytes = bs58.decode(base58PrivateKey);
        return Keypair.fromSecretKey(privateKeyBytes);
    }

    // Validate token metadata
    validateTokenMetadata(metadata: TokenMetadata): {success: boolean, error: string} {
        if (!metadata.name || metadata.name.length > 32) {
            return {success: false, error: 'Token name is required and should be less then 32 character long.'};
        } else if (!metadata.symbol || metadata.symbol.length > 10) {
            return {success: false, error: 'Token symbol is required and should be less then 10 character long.'};
        } else if (!metadata.media) {
            return {success: false, error: 'Token icon media is required.'};
        } else if (metadata.supply === 0 || metadata.supply && (metadata.supply < 1 || metadata.supply > 1e19)) {
            return {success: false, error: 'Token supply should be positive number and max 1e19.'};
        } else if (metadata.decimals && (metadata.decimals < 0 || metadata.decimals > 9)) {
            return {success: false, error: 'Token decimal should not be negative number and more then 9.'};
        }
        return {success: true, error: ''};
    }

    // Validate NFT metadata
    validateNFTMetadata(metadata: NftMetadata): {success: boolean, error: string} {
        if (!metadata.title || metadata.title.length > 32) {
            return {success: false, error: 'NFT name is required and should be less then 32 character long.'};
        } else if (!metadata.description) {
            return {success: false, error: 'NFT description is required.'};
        } else if (!metadata.media) {
            return {success: false, error: 'NFT media file is required.'};
        } else if (metadata.attributes) {
            if (metadata.attributes.length > 6) {
                return {success: false, error: 'NFT attributes shoud not be more then 6.'};
            }
            for (let i of metadata.attributes) {
                if (i.type.length > 32 || i.value.length > 64) {
                    return {success: false, error: "NFT attribute type shouldn\'t be longer then 32 and value shoudn\'t be longer then 64."};
                }
            }
        }
        
        // validate attributes type and value length 
        return {success: true, error: ''};
    }
}