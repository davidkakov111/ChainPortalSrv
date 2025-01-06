-- Add unique constraint to paymentTxSignature
ALTER TABLE "MintTxHistory" ADD CONSTRAINT "MintTxHistory_paymentTxSignature_key" UNIQUE ("paymentTxSignature"); 