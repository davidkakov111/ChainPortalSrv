import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { cliEnv } from 'src/shared/interfaces';

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
}
