import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, ConfirmOptions, TransactionSignature, clusterApiUrl, VersionedTransactionResponse, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, Keypair, MessageCompiledInstruction, ConfirmedTransactionMeta } from '@solana/web3.js';
import { cliEnv } from 'src/shared/interfaces';
import { PrismaService } from 'src/prisma/prisma/prisma.service';
import { assetType } from 'src/shared/types';
import { SolanaHelpersService } from '../solana-helpers/solana-helpers.service';

@Injectable()
export class SolanaService {
    private connection: Connection;
    private cliEnv: cliEnv;
    private defaultLamportTransactionFee: 5000 = 5000;

    constructor(
        private readonly configSrv: ConfigService,
        private readonly prismaSrv: PrismaService,
        private readonly solHelpersSrv: SolanaHelpersService
    ) {
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
            
            // If status is null, transaction is too old or doesn't exist
            if (!status?.value) {
                // For old transactions, try to get the transaction details directly, if have it is confirmed
                const tx = await this.getTransactionDetails(txSignature);
                if (tx) return true;
            }

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
            const fromWallet = this.solHelpersSrv.getChainPortalKeypair(base58PrivateKey);
            
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
            (ix) => accountKeys[ix.programIdIndex].toString() === SYSTEM_PROGRAM_ID && 
                // Check for transfer instruction (0x02)
                Buffer.from(ix.data).readUInt8(0) === 2 &&
                // Ensure have account indexes for sender and recipient
                ix.accountKeyIndexes.length === 2
        );
        if (!transferInstruction) {
            return {isValid: false, errorMessage: "Could not find SOL transfer instruction in your transaction, it seems like the transaction is not a valid SOL transfer. Please try again."};
        };

        return {isValid: true, data: {transferInstruction, accountKeys, meta: txDetails.meta}};
    }

    // Refund the user in SOL after deducting the estimated refund fee and save the transaction to the db
    async refundInSOL(pubkey: PublicKey, solAmountWithFee: number, insuficientPaymentTxSignature: string, assetType: assetType, originalPaymnetSolAmount: number): Promise<{
        refunded: boolean;
        message: string;
    }> {
        // Get Chain Portal's solana private key from environment variables
        const envSenderPkKey = this.cliEnv.blockchainNetworks.solana.selected === "devnet" ? 'solanaDevBase58PrivateKey' : 'solanaBase58PrivateKey';
        const chainPortalPrivateKey = this.configSrv.get<string>(envSenderPkKey);

        // Calculate the estimated refund fee in SOL
        const estimatedSolRefundFee = this.defaultLamportTransactionFee / LAMPORTS_PER_SOL;

        // Refund the user
        const refundObj = await this.transferSol(chainPortalPrivateKey, pubkey.toString(), solAmountWithFee - estimatedSolRefundFee);
        if (refundObj.success) {
            // Calculate the exact refund-related expenses; if not possible, use the estimated amount
            let expenseSolAmount = solAmountWithFee;
            try {
                const change = await this.getOurSolBallanceChange(refundObj.signature);
                if (change && change < 0) {
                    expenseSolAmount = change * -1;
                } else {
                    console.error(`Refund tx ${refundObj.signature} succeeded but it's exact expense SOL amount is unknown, calculated ${change} but it should be negative. Using estimate instead: ${solAmountWithFee}`);
                }
            } catch (error) {
                console.error(`Refund tx ${refundObj.signature} succeeded but it's exact expense SOL amount unknown due to error: ${error}. Using estimate instead: ${solAmountWithFee}`);
            }

            // Save the transaction to the db
            this.prismaSrv.saveMintTxHistory({
                assetType: assetType,
                blockchain: 'SOL',
                paymentPubKey: pubkey.toString(),
                paymentAmount: originalPaymnetSolAmount,
                expenseAmount: expenseSolAmount,
                paymentTxSignature: insuficientPaymentTxSignature,
                rewardTxs: [{txSignature: refundObj.signature, type: 'refund'}]
            });

            console.error('Refund of the user\'s transaction ('+ insuficientPaymentTxSignature +') was successful: ', refundObj.signature);
            return {refunded: true, message: "Your transaction amount was refunded after deducting the estimated refund fee. Please try again."};
        } else {
            console.error('Refund of the user\'s transaction ('+ insuficientPaymentTxSignature +') failed: ', refundObj.error);

            // Save the transaction to the db
            this.prismaSrv.saveMintTxHistory({
                assetType: assetType,
                blockchain: 'SOL',
                paymentPubKey: pubkey.toString(),
                paymentAmount: solAmountWithFee,
                expenseAmount: solAmountWithFee,
                paymentTxSignature: insuficientPaymentTxSignature,
                rewardTxs: [{txSignature: `Refund failed (the expense amount is unknown on the ChainPortal side), error: ${refundObj.error}`, type: 'refund'}]
            });
            return {refunded: false, message: "Your refund failed. Please try again."};
        }
    }

    // Redirect payment if it is enough for the refund fee
    async redirectSolPayment(paymentTxSignature: string, assetType: assetType, needToDeductSol?: number): Promise<{isValid: boolean, message?: string}> {
        try {
            // Get transfer instruction by transaction signature
            const txDetails = await this.getSenderPubKeyAndOurBallanceChange(paymentTxSignature);
            if (!txDetails.isValid) return {isValid: false, message: txDetails.errorMessage};
            const {senderPubkey, recipientBalanceChange} = txDetails;
            
            // Deduct optional sol amount (for metadata upload etc.)
            const recipientBalanceChangeWithDeduct = needToDeductSol ? (recipientBalanceChange - (needToDeductSol * LAMPORTS_PER_SOL)) : recipientBalanceChange;

            // Redirect the payment if it is enough for the refund fee
            const estimatedRefundFee = this.defaultLamportTransactionFee;
            if (recipientBalanceChangeWithDeduct > estimatedRefundFee) {
                // This function also deducts the estimated refund fee
                const refundObj = await this.refundInSOL(senderPubkey, (recipientBalanceChangeWithDeduct / LAMPORTS_PER_SOL), paymentTxSignature, assetType, (recipientBalanceChange / LAMPORTS_PER_SOL));
                return {isValid: refundObj.refunded, message: refundObj.message};
            } else {
                console.error('The users transaction ('+ paymentTxSignature +') did not transfer enough SOL, even for refund (with deduction):', paymentTxSignature);
                return {isValid: false, message: "Your transaction did not transfer enough SOL, even for refund. Please try again."};    
            }
        } catch (error) {
            console.error(`Error in "redirectSolPayment": ${error}`);
            return {isValid: false, message: "Your transaction was refunded after deducting the applicable fees, but it may have failed. Please try again."};    
        }
    }

    // Validate payment transaction by transaction signature
    async validateSolPaymentTx(paymentTxSignature: string, requiredSolPaymentAmount: number, assetType: assetType): Promise<{isValid: boolean, errorMessage?: string}> {
        // Get transfer instruction by transaction signature
        const txDetails = await this.getSenderPubKeyAndOurBallanceChange(paymentTxSignature);
        if (!txDetails.isValid) return {isValid: false, errorMessage: txDetails.errorMessage};
        const {senderPubkey, recipientBalanceChange} = txDetails;

        // Refund the user, bc coudnt calculate the total price for their NFT minting
        if (!requiredSolPaymentAmount) {
            const estimatedRefundFee = this.defaultLamportTransactionFee;
            if (recipientBalanceChange > estimatedRefundFee) {
                // This function also deducts the estimated refund fee
                const refundObj = await this.refundInSOL(senderPubkey, (recipientBalanceChange / LAMPORTS_PER_SOL), paymentTxSignature, assetType, (recipientBalanceChange / LAMPORTS_PER_SOL));
                if (refundObj.refunded) {
                    return {isValid: false, errorMessage: 'Unable to calculate the total price for your operation so your transaction amount was refunded after deducting the estimated refund fee. Please try again.'};
                } else {
                    return {isValid: false, errorMessage: 'Unable to calculate the total price for your operation and your refund failed. Please try again.'};
                }
            } else {
                console.error('The users transaction ('+ paymentTxSignature +') did not transfer enough SOL, even for refund. I also coudn\'t calculate the total price for their operation. Expected: ', requiredSolPaymentAmount, 'Received: ', recipientBalanceChange / LAMPORTS_PER_SOL);
                return {isValid: false, errorMessage: "Your transaction did not transfer SOL. Please try again."};
            }
        }

        // Ensure the payment amount is enough
        if (recipientBalanceChange < (requiredSolPaymentAmount * LAMPORTS_PER_SOL)) {
            const estimatedRefundFee = this.defaultLamportTransactionFee;
            if (recipientBalanceChange > estimatedRefundFee) {
                // Refund the user, bc their transaction did not transfer enough SOL (this function also deducts the estimated refund fee)
                const refundObj = await this.refundInSOL(senderPubkey, (recipientBalanceChange / LAMPORTS_PER_SOL), paymentTxSignature, assetType, (recipientBalanceChange / LAMPORTS_PER_SOL));
                return {isValid: false, errorMessage: refundObj.message};
            } else {
                console.error('The users transaction ('+ paymentTxSignature +') did not transfer enough SOL, even for refund. Expected: ', requiredSolPaymentAmount, 'Received: ', recipientBalanceChange / LAMPORTS_PER_SOL);
                return {isValid: false, errorMessage: "Your transaction did not transfer SOL. Please try again."};
            }
        }

        return {isValid: true};
    }

    // Get sender pubkey and Chain Portal's balance change from a transaction by transaction signature
    async getSenderPubKeyAndOurBallanceChange(paymentTxSignature: string): Promise<{
        isValid: boolean;
        errorMessage: string;
        senderPubkey?: undefined;
        recipientBalanceChange?: undefined;
    } | {
        isValid: boolean;
        senderPubkey: PublicKey;
        recipientBalanceChange: number;
        errorMessage?: undefined;
    }> {
        // Get transfer instruction by transaction signature
        const transferIx = await this.transferIxByTxSignature(paymentTxSignature);
        if (!transferIx.isValid) return {isValid: false, errorMessage: transferIx.errorMessage};
        const {transferInstruction, accountKeys, meta} = transferIx.data;

        // Get sender and recipient from account indices in the transfer instruction
        const senderPubkey = accountKeys[transferInstruction.accountKeyIndexes[0]];
        const recipientPubkey = accountKeys[transferInstruction.accountKeyIndexes[1]];

        // Get Chain Portal's public key
        const ChainPortalPubKey = this.solHelpersSrv.getChainPortalKeypair(null, this.cliEnv).publicKey;

        // Check if the transaction was sent to Chain Portal's public key
        if (recipientPubkey.toString() !== ChainPortalPubKey.toString()) {
            console.error('The users transaction ('+ paymentTxSignature +') was not sent to Chain Portal\'s public key: ', recipientPubkey);
            return {isValid: false, errorMessage: "Your transaction was not sent to Chain Portal's public key. Please try again."};
        };

        // Calculate recipient's balance change
        const recipientIndex = accountKeys.indexOf(recipientPubkey);
        const recipientBalanceChange = meta.postBalances[recipientIndex] - meta.preBalances[recipientIndex];

        return {isValid: true, senderPubkey, recipientBalanceChange}
    }

    // Get Chain Portal's balance change in SOL from a transaction by transaction signature, regardless of the sender
    async getOurSolBallanceChange(txSignature: string): Promise<number | null> {
        // Wait for confirmation and get transaction details
        await this.waitForTransaction(txSignature, 'confirmed');
        const txDetails = await this.getTransactionDetails(txSignature);

        if (txDetails?.meta) {
            // Get Chain Portal's public key
            const ChainPortalPubKey = this.solHelpersSrv.getChainPortalKeypair(null, this.cliEnv).publicKey;

            const chainPortalIndex = txDetails.transaction.message.staticAccountKeys.findIndex(
                key => key.equals(ChainPortalPubKey)
            );
            return (txDetails.meta.postBalances[chainPortalIndex] - txDetails.meta.preBalances[chainPortalIndex]) / LAMPORTS_PER_SOL;
        } else {
            return null;
        }
    }
}
