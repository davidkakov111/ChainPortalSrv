import { Injectable } from '@nestjs/common';
import { assetType, rewardTxsType } from 'src/shared/types';
import { formatEther, getDefaultProvider, AbstractProvider, TransactionResponse, parseEther, FeeData } from "ethers";
import { ConfigService } from '@nestjs/config';
import { cliEnv } from 'src/shared/interfaces';
import { EthereumHelpersService } from 'src/ethereum/ethereum-helpers/ethereum-helpers.service';
import { PrismaService } from 'src/prisma/prisma/prisma.service';

@Injectable()
export class EthereumService {
    provider: AbstractProvider;
    cliEnv: cliEnv;
    ethTransferGasLimit: 21000n = 21000n; // Fixed bigint amount for ETH transfers

    constructor (
        private readonly configSrv: ConfigService,
        private readonly ethereumHelpersSrv: EthereumHelpersService,
        private readonly prismaSrv: PrismaService,
    ) {
        const strCliEnv = this.configSrv.get<string>('cli_environment');
        this.cliEnv = JSON.parse(strCliEnv) as cliEnv;
        this.provider = getDefaultProvider(this.cliEnv.blockchainNetworks.ethereum.selected);
    }

    // Transfer specific amount of ETH to a destination address, from ChainPortal's wallet (Dont wait for confirmation)
    async transferEth(pubKey: string, ethAmount: number, feeData?: FeeData): Promise<{ success: boolean; signature?: string; error?: string }> {
        try {
            if (!feeData) feeData = await this.provider.getFeeData();
            const cpWallet = this.ethereumHelpersSrv.getChainPortalWallet('', this.cliEnv).connect(this.provider);

            // Sign and send transaction
            const txResponse = await cpWallet.sendTransaction({
                to: pubKey,
                value: parseEther(String(ethAmount.toFixed(18))), // Convert ETH amount to Wei
                gasLimit: this.ethTransferGasLimit,
                maxFeePerGas: feeData.maxFeePerGas,
                maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
            });
            // Maybe here need to wait for 1 confirmation, but skipp it for now to be faster

            return { success: true, signature: txResponse.hash };
        } catch (error) {
            console.error('Error in "transferEth":', error);
            return { success: false, error: 'Unknown error occurred during transfer' };
        }
    }

    // Refund the user in ETH after deducting the estimated refund fee and save the transaction to the db
    async refundInEth(pubkey: string, refundEthAmountWithFee: number, receivedEthAmount: number, insuficientPaymentTxSignature: string, assetType: assetType, 
        estEthTransferFee?: number, feeData?: FeeData|null, reasonForDeduct?: {txSignature: string, type: rewardTxsType}[]): Promise<{
            refunded: boolean; message: string;
        }> {
        try {
            // Get estimated ETH transfer fee if not provided
            if (!estEthTransferFee) { 
                const result = await this.estimateEthTransferFee();
                if (!result.success) return {refunded: false, message: 'Couldn\'t calculate the fee required for the ETH refund.'};
                estEthTransferFee = result.ethFee;
                feeData = result.feeData;
            }

            // Refund the user
            const refundObj = await this.transferEth(pubkey, refundEthAmountWithFee - estEthTransferFee, feeData);
            
            // Save the transaction to the db
            await this.prismaSrv.saveMintTxHistory({
                assetType: assetType,
                blockchain: 'ETH',
                paymentPubKey: pubkey,
                paymentAmount: receivedEthAmount,
                expenseAmount: receivedEthAmount,                    
                paymentTxSignature: insuficientPaymentTxSignature,
                rewardTxs: [...(reasonForDeduct ? reasonForDeduct : []), {
                    txSignature: refundObj.success ? refundObj.signature : `Refund failed (the expense amount is unknown on the ChainPortal side), error: ${refundObj.error}`, 
                    type: 'refund'
                }]
            });
            if (refundObj.success) {
                console.log('Refund of the user\'s transaction ('+ insuficientPaymentTxSignature +') was successful: ', refundObj.signature);
                return {refunded: true, message: "Your transaction amount was refunded after deducting the estimated fee(s). Please try again."};
            } else {
                console.error('Refund of the user\'s transaction ('+ insuficientPaymentTxSignature +') failed: ', refundObj.error);
                return {refunded: false, message: "Your refund failed. Please try again."};
            };
        } catch (error) {

            // Save the transaction to the db
            await this.prismaSrv.saveMintTxHistory({
                assetType: assetType,
                blockchain: 'ETH',
                paymentPubKey: pubkey,
                paymentAmount: receivedEthAmount,
                expenseAmount: receivedEthAmount,                    
                paymentTxSignature: insuficientPaymentTxSignature,
                rewardTxs: [...(reasonForDeduct ? reasonForDeduct : []), {
                    txSignature: `Refund failed (the expense amount is unknown on the ChainPortal side), error in "refundInEth": ${error}`, 
                    type: 'refund'
                }]
            });
            console.error('Refund of the user\'s transaction ('+ insuficientPaymentTxSignature +') failed, error in "refundInEth": ', error);
            return {refunded: false, message: "Your transaction was refunded after deducting the applicable fee(s), but it may have failed. Please try again."};
        }
    }

    // Redirect payment if it is enough for the refund fee and was sent to ChainPortal
    async redirectEthPayment(paymentTxSignature: string, assetType: assetType, needToDeductEth?: number, 
        reasonForDeduct?: {txSignature: string, type: rewardTxsType}[]): Promise<{isValid: boolean, message?: string}> {
        try {
            // Retrieve payment transaction details after 4 confirmation
            const paymentTx = await this.txDetailsAfterConfirmation(paymentTxSignature);
            if (!paymentTx.success) return {isValid: false, message: paymentTx.error};
            const senderPubkey = paymentTx.txDetails.from;
            const receivedEthAmount = parseFloat(paymentTx.txDetails.value ? formatEther(paymentTx.txDetails.value) : "0");
            
            // Ensure the transaction was sent to ChainPortal
            const cpWallet = this.ethereumHelpersSrv.getChainPortalWallet();
            if (paymentTx.txDetails.to !== cpWallet.address) return {isValid: false, message: 'The recipient of the payment transaction is incorrect.'};

            // Deduct optional ETH amount (for metadata upload etc.)
            const receivedEthAmountWithDeduct = needToDeductEth ? (receivedEthAmount - needToDeductEth) : receivedEthAmount;

            // Get the current estimated fee for an ETH transfer transaction (for this refund)
            const feeResult = await this.estimateEthTransferFee();
            if (!feeResult.success) return {isValid: false, message: 'Couldn\'t calculate the fee required for the ETH transfer. Please try again.'};

            // Redirect the payment if it is enough for the refund fee
            if (receivedEthAmountWithDeduct > feeResult.ethFee) {
                // This function also deducts the estimated refund fee
                const refundObj = await this.refundInEth(senderPubkey, receivedEthAmountWithDeduct, receivedEthAmount, paymentTxSignature, 
                    assetType, feeResult.ethFee, feeResult.feeData, reasonForDeduct);
                return {isValid: refundObj.refunded, message: refundObj.message};
            } else {
                console.error('The users transaction ('+ paymentTxSignature +') did not transfer enough ETH, even for refund (with possible deduction)');
                return {isValid: false, message: "Your transaction did not transfer enough ETH, even for refund. Please try again."};    
            }
        } catch (error) {
            console.error(`Error in "redirectEthPayment": ${error}`);
            return {isValid: false, message: "Your transaction was refunded after deducting the applicable fees, but it may have failed. Please try again."}; 
        }
    }

    // Return transaction details by transaction hash after at least 4 confirmation
    async txDetailsAfterConfirmation(txHash: string): Promise<{success: boolean, txDetails?: TransactionResponse, error?: 'Payment transaction failed or dropped'|'Payment transaction not found'}> {
        // Step 1: Wait for the transaction to be confirmed (at least 4 confirmations, with 2 min timeout)
        const txReceipt = await this.provider.waitForTransaction(txHash, 4, 120000);
        if (!txReceipt || txReceipt.status !== 1) return { success: false, error: "Payment transaction failed or dropped" };
        
        // Step 2: Fetch the transaction details after confirmation
        const tx = await this.provider.getTransaction(txHash);
        if (!tx) return { success: false, error: "Payment transaction not found" };
        return {success: true, txDetails: tx};
    }

    //? --- Currently unused --- Ensure the payment transaction was sent to the correct recipent with the correct amount
    verifyPaymentTx(txDetails: TransactionResponse, expectedRecipientHexPubkey: string, expectedEthAmount: number): {
        isValid: boolean,
        sender: string,
        txAmount: number,
    } {
        const isRecipientCorrect = txDetails.to === expectedRecipientHexPubkey;
        const sentEthAmount = parseFloat(txDetails.value ? formatEther(txDetails.value) : "0");
        const isAmountCorrect = sentEthAmount >= expectedEthAmount;
        return {
            isValid: isRecipientCorrect && isAmountCorrect,
            sender: txDetails.from,
            txAmount: sentEthAmount
        };
    }

    // Get the current estimated fee in Eth, for a simple ETH transfer transaction
    async estimateEthTransferFee(gasPrice?: bigint): Promise<{success: boolean; ethFee: number; feeData?: FeeData}> {
        try {
            if (!gasPrice) { // Get gas price if not provided
                var feeData = await this.provider.getFeeData();
                gasPrice = feeData.gasPrice;
            }
    
            const fee = gasPrice * this.ethTransferGasLimit; // Total fee in wei
            return {success: true, ethFee: Number(formatEther(fee)) * 1.3, feeData}; // Convert to ETH and incerase by 30%, bc the actual fee could be more    
        } catch (error) {
            console.error('Error in "estimateEthTransferFee": ', error);
            return {success: false, ethFee: Infinity};
        }
    }

    // Validate payment transaction by transaction signature
    async validateEthPaymentTx(paymentTxSignature: string, requiredEthPaymentAmount: number, assetType: assetType): Promise<{
        isValid: boolean, errorMessage?: string, senderPubkey?: string, receivedEthAmount?: number
    }> {
        // Get transaction details by transaction signature after at least 4 confirmation
        const txDetails = await this.txDetailsAfterConfirmation(paymentTxSignature);
        if (!txDetails.success) return {isValid: false, errorMessage: txDetails.error};
        const sentEthAmount = parseFloat(txDetails.txDetails.value ? formatEther(txDetails.txDetails.value) : "0");
        const recipent = txDetails.txDetails.to;
        const sender = txDetails.txDetails.from;

        // Ensure the transaction was sent to ChainPortal
        const cpWallet = this.ethereumHelpersSrv.getChainPortalWallet('', this.cliEnv);
        if (recipent !== cpWallet.address) return {isValid: false, errorMessage: 'The recipient of the payment transaction is incorrect.'};

        // Refund the user, bc coudnt calculate the total price for their operation
        if (!requiredEthPaymentAmount) {
            // Get the current estimated fee for an ETH transfer transaction (for this refund)
            const feeResult = await this.estimateEthTransferFee();
            if (!feeResult.success) return {isValid: false, errorMessage: 'Couldn\'t calculate the fee required for the refund transaction. Please try again.'};

            // If the received amount is enough for at least the refund fee then refund
            if (sentEthAmount > feeResult.ethFee) {
                // This function also deducts the estimated refund fee
                const refundObj = await this.refundInEth(sender, sentEthAmount, sentEthAmount, paymentTxSignature, 
                    assetType, feeResult.ethFee, feeResult.feeData);
                return {isValid: false, errorMessage: refundObj.message};
            } else {
                console.error('The users transaction ('+ paymentTxSignature +') did not transfer enough ETH, even for refund. I also coudn\'t calculate the total price for their operation. Expected: ', requiredEthPaymentAmount, 'Received: ', sentEthAmount);
                return {isValid: false, errorMessage: "Your transaction did not transfer ETH. Please try again."};
            }
        }

        // Ensure the payment amount is enough
        if (sentEthAmount < requiredEthPaymentAmount) {
            // Get the current estimated fee for an ETH transfer transaction (for this refund)
            const feeResult = await this.estimateEthTransferFee();
            if (!feeResult.success) return {isValid: false, errorMessage: 'Your payment amount is insufficient, and couldn\'t process your refund because the required transaction fee couldn\'t be calculated. Please try again.'};

            if (sentEthAmount > feeResult.ethFee) {
                // Refund the user, bc their transaction did not transfer enough ETH for their operation, but it's enough for the refund. 
                // (this function also deducts the estimated refund fee)
                const refundObj = await this.refundInEth(sender, sentEthAmount, sentEthAmount, paymentTxSignature, 
                    assetType, feeResult.ethFee, feeResult.feeData);
                return {isValid: false, errorMessage: refundObj.message};
            } else {
                console.error('The users transaction ('+ paymentTxSignature +') did not transfer enough ETH, even for refund. Expected: ', requiredEthPaymentAmount, 'Received: ', sentEthAmount);
                return {isValid: false, errorMessage: "Your transaction did not transfer ETH. Please try again."};
            }
        }

        return {isValid: true, senderPubkey: sender, receivedEthAmount: sentEthAmount};
    }
}
