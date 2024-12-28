import { Injectable } from '@nestjs/common';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

@Injectable()
export class SolanaHelpersService {
    
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
}
