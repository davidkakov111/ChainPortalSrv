import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, ConfirmOptions, TransactionSignature, clusterApiUrl, VersionedTransactionResponse, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, Keypair, MessageCompiledInstruction, ConfirmedTransactionMeta } from '@solana/web3.js';
import { cliEnv } from 'src/shared/interfaces';
import bs58 from 'bs58';

@Injectable()
export class SolanaService {
    private connection: Connection;
    private cliEnv: cliEnv;

    constructor(private readonly configSrv: ConfigService) {
        // Initialize connection to the Solana cluster
        const strCliEnv = this.configSrv.get<string>('cli_environment');
        this.cliEnv = JSON.parse(strCliEnv) as cliEnv;
        this.connection = new Connection(clusterApiUrl(this.cliEnv.blockchainNetworks.solana.selected === 'devnet' ? 'devnet' : 'mainnet-beta'));
    }

    // Wait for a transaction to reach a specific confirmation level on the blockchain
    async waitForTransaction(
        txSignature: TransactionSignature,
        confirmationLevel: ConfirmOptions['commitment']
    ): Promise<boolean> {
        try {
            // First check if transaction is already confirmed
            const status = await this.connection.getSignatureStatus(txSignature);
            const confirmationLevels = ['processed', 'confirmed', 'finalized'];
            const statusIndex = confirmationLevels.indexOf(status.value?.confirmationStatus);
            const requestedIndex = confirmationLevels.indexOf(confirmationLevel);
            if (statusIndex >= requestedIndex && statusIndex !== -1) {
                return true;
            }

            // If not confirmed, wait for confirmation
            const latestBlockhash = await this.connection.getLatestBlockhash();
            const confirmation = await this.connection.confirmTransaction({
                signature: txSignature,
                blockhash: latestBlockhash.blockhash,
                lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
            }, confirmationLevel);

            return confirmation.value.err === null;
        } catch (error) {
            console.error('Error waiting for transaction confirmation:', error);
            return false;
        }
    }

    // Get transaction details by transaction signature
    async getTransactionDetails(signature: TransactionSignature): Promise<VersionedTransactionResponse | null> {
        try {
            // Fetch the transaction details
            const transaction = await this.connection.getTransaction(signature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0,
            });
            if (!transaction) {
                console.error('Transaction not found');
                return null;
            }

            return transaction;
        } catch (error) {
            console.error('Error fetching transaction details: ', error);
            return null;
        }
    }

    // Transfer specific amount of SOL to a destination address, from the sender's wallet (Dont wait for confirmation)
    async transferSol(
        base58PrivateKey: string,
        pubKey: string,
        solAmount: number
    ): Promise<{ success: boolean; signature?: string; error?: string }> {
        try {
            // Convert the base58 private key to Keypair
            const privateKeyBytes = bs58.decode(base58PrivateKey);
            const fromWallet = Keypair.fromSecretKey(privateKeyBytes);
            
            // Convert destination address string to PublicKey
            const toWallet = new PublicKey(pubKey);
            
            // Create transfer instruction
            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: fromWallet.publicKey,
                    toPubkey: toWallet,
                    lamports: solAmount * LAMPORTS_PER_SOL
                })
            );

            // Get latest blockhash
            const latestBlockhash = await this.connection.getLatestBlockhash();
            transaction.recentBlockhash = latestBlockhash.blockhash;
            transaction.feePayer = fromWallet.publicKey;

            // Sign and send transaction
            transaction.sign(fromWallet);
            const rawTransaction = transaction.serialize();
            const signature = await this.connection.sendRawTransaction(rawTransaction, {
                skipPreflight: false,
                preflightCommitment: 'confirmed'
            });
            
            return { success: true, signature };
        } catch (error) {
            console.error('Error in transferSol:', error);
            return { 
                success: false, 
                error: 'Unknown error occurred during transfer' 
            };
        }
    }

    // Get transfer instruction by transaction signature
    async transferIxByTxSignature(txSignature: string): Promise<{
        isValid: boolean;
        errorMessage: string;
        data?: undefined;
    } | {
        isValid: boolean;
        data: {
            transferInstruction: MessageCompiledInstruction;
            accountKeys: PublicKey[];
            meta: ConfirmedTransactionMeta;
        };
        errorMessage?: undefined;
    }> {
        // Wait for the payment transaction to be confirmed
        const isTxConfirmed = await this.waitForTransaction(txSignature, 'confirmed');
        if (!isTxConfirmed) {
            return {isValid: false, errorMessage: 'Unable to confirm payment transaction. There may be an issue with the blockchain network or your payment. Please try again.'};
        }

        // Get transaction details
        const txDetails = await this.getTransactionDetails(txSignature);
        if (!txDetails) {
            return {isValid: false, errorMessage: "Unable to fetch transaction details. There may be an issue with the blockchain network or your payment. Please try again."};
        }

        // If the transaction contains error
        if (txDetails.meta.err !== null) {
            console.error('The users transaction ('+ txSignature +') contains an error: ', txDetails.meta.err);
            return {isValid: false, errorMessage: "Your transaction contains an error. Please try again."};
        };

        const accountKeys = txDetails.transaction.message.staticAccountKeys;

        // Find the SOL transfer instruction by checking program ID
        const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
        const transferInstruction = txDetails.transaction.message.compiledInstructions.find(
            (ix) => accountKeys[ix.programIdIndex].toString() === SYSTEM_PROGRAM_ID && ix.data.toString().startsWith('02')
        );
        if (!transferInstruction) {
            return {isValid: false, errorMessage: "Could not find SOL transfer instruction in your transaction, it seems like the transaction is not a valid SOL transfer. Please try again."};
        };

        return {isValid: true, data: {transferInstruction, accountKeys, meta: txDetails.meta}};
    }

    // Refund the user in SOL and deduct the estimated refund fee
    async refundInSOL(pubkey: PublicKey, solAmountWithFee: number, insuficientPaymentTxSignature: string): Promise<{
        refunded: boolean;
        message: string;
    }> {
        // Get Chain Portal's solana private key from environment variables
        const envSenderPkKey = this.cliEnv.blockchainNetworks.solana.selected === "devnet" ? 'solanaDevBase58PrivateKey' : 'solanaBase58PrivateKey';
        const chainPortalPrivateKey = this.configSrv.get<string>(envSenderPkKey);

        // Calculate the estimated refund fee in SOL
        const estimatedSolRefundFee = 5500 / LAMPORTS_PER_SOL;

        // Refund the user
        const refundObj = await this.transferSol(chainPortalPrivateKey, pubkey.toString(), solAmountWithFee - estimatedSolRefundFee);
        if (refundObj.success) {
            console.error('The user\'s transaction ('+ insuficientPaymentTxSignature +') did not transfer enough SOL, and their refund was successful: ', refundObj.signature);
            return {refunded: true, message: "Your transaction did not transfer enough SOL, so your transaction amount was refunded after deducting the estimated refund fee. Please try again."};
        } else {
            console.error('The user\'s transaction ('+ insuficientPaymentTxSignature +') did not transfer enough SOL, and their refund failed: ', refundObj.error);
            return {refunded: false, message: "Your transaction did not transfer enough SOL and your refund failed. Please try again."};
        }
    }

    // Validate payment transaction by transaction signature
    async validateSolPaymentTx(paymentTxSignature: string, requiredSolPaymentAmount: number): Promise<{isValid: boolean, errorMessage?: string}> {
        // Get transfer instruction by transaction signature
        const transferIx = await this.transferIxByTxSignature(paymentTxSignature);
        if (!transferIx.isValid) return {isValid: false, errorMessage: transferIx.errorMessage};
        const {transferInstruction, accountKeys, meta} = transferIx.data;

        // Get sender and recipient from account indices in the transfer instruction
        const senderPubkey = accountKeys[transferInstruction.accountKeyIndexes[0]];
        const recipientPubkey = accountKeys[transferInstruction.accountKeyIndexes[1]];

        // Get Chain Portal's public key from environment variables // TODO - Make it dynamic, dont use hardcoded pubkey, calculate it from the private key
        const ChainPortalPubKey = this.cliEnv.blockchainNetworks.solana.pubKey;
        
        // Check if the transaction was sent to Chain Portal's public key
        if (recipientPubkey.toString() !== ChainPortalPubKey) {
            console.error('The users transaction ('+ paymentTxSignature +') was not sent to Chain Portal\'s public key: ', recipientPubkey);
            return {isValid: false, errorMessage: "Your transaction was not sent to Chain Portal's public key. Please try again."};
        };

        // Calculate recipient's balance change
        const recipientIndex = accountKeys.indexOf(recipientPubkey);
        const recipientBalanceChange = meta.postBalances[recipientIndex] - meta.preBalances[recipientIndex];

        // Refund the user, bc coudnt calculate the total price for their NFT minting
        if (!requiredSolPaymentAmount) {
            const estimatedRefundFee = 5500;
            if (recipientBalanceChange > estimatedRefundFee) {
                // This function also deducts the estimated refund fee
                const refundObj = await this.refundInSOL(senderPubkey, (recipientBalanceChange / LAMPORTS_PER_SOL), paymentTxSignature);
                if (refundObj.refunded) {
                    return {isValid: false, errorMessage: 'Unable to calculate the total price for your NFT minting so your transaction amount was refunded after deducting the estimated refund fee. Please try again.'};
                } else {
                    return {isValid: false, errorMessage: 'Unable to calculate the total price for your NFT minting and your refund failed. Please try again.'};
                }
            } else {
                console.error('The users transaction ('+ paymentTxSignature +') did not transfer enough SOL, even for refund. I also coudn\'t calculate the total price for their NFT minting. Expected: ', requiredSolPaymentAmount, 'Received: ', recipientBalanceChange / LAMPORTS_PER_SOL);
                return {isValid: false, errorMessage: "Your transaction did not transfer SOL. Please try again."};
            }
        }

        // Ensure the payment amount is enough
        if (recipientBalanceChange < (requiredSolPaymentAmount * LAMPORTS_PER_SOL)) {
            const estimatedRefundFee = 5500;
            if (recipientBalanceChange > estimatedRefundFee) {
                // Refund the user, bc their transaction did not transfer enough SOL (this function also deducts the estimated refund fee)
                const refundObj = await this.refundInSOL(senderPubkey, (recipientBalanceChange / LAMPORTS_PER_SOL), paymentTxSignature);
                return {isValid: false, errorMessage: refundObj.message};
            } else {
                console.error('The users transaction ('+ paymentTxSignature +') did not transfer enough SOL, even for refund. Expected: ', requiredSolPaymentAmount, 'Received: ', recipientBalanceChange / LAMPORTS_PER_SOL);
                return {isValid: false, errorMessage: "Your transaction did not transfer SOL. Please try again."};
            }
        }

        return {isValid: true};
    }
}
