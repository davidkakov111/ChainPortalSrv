import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cliEnv } from 'src/shared/interfaces';
import { ethers } from "ethers";

@Injectable()
export class EthereumHelpersService {
    constructor(private readonly configSrv: ConfigService) {}

    // Method to create a new Ethereum wallet
    createWallet() {
        const wallet = ethers.Wallet.createRandom();
        return {hexPrivateKey: wallet.privateKey, publicKey: wallet.address};
    }
    
    // Convert the hexadecimal private key to wallet and return it (The params are optional to speed up the process)
    getChainPortalWallet(hexPrivateKey?: string, cliEnv?: cliEnv): ethers.Wallet {
        if (!hexPrivateKey) {
            if (!cliEnv) {
                // Get cli environment from environment variables if not provided
                const strCliEnv = this.configSrv.get<string>('cli_environment');
                cliEnv = JSON.parse(strCliEnv) as cliEnv;
            }
            
            // Get ChainPortal's ethereum private key from environment variables
            const PrivateKey = cliEnv.blockchainNetworks.ethereum.selected === "mainnet" ? 'ethereumHexPrivateKey' : 'ethereumSepoliaHexPrivateKey';
            hexPrivateKey = this.configSrv.get<string>(PrivateKey);
        }

        const wallet = new ethers.Wallet(
            hexPrivateKey, 
            ethers.getDefaultProvider(cliEnv.blockchainNetworks.ethereum.selected)
        );
        return wallet;
    }
}