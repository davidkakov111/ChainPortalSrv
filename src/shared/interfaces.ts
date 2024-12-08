import { assetType, blockchainSymbols, operationType } from "./types"

export interface cliEnv {
  reownProjectId: string,
  blockchainNetworks: {
    solana: {
      selected: 'devnet'|'mainnet',
      pubKey: string,
    }, 
  },
}

export interface transaction {
  id: number,
  operationType: operationType,
  assetType: assetType,
  blockchain: blockchainSymbols,
  paymentPubKey: string,
  paymentAmount: number,
  expenseAmount: number,
  date: Date,
  MintTxHistories?: {
    id: number,
    mainTxHistoryId: number,
    paymentTxSignature: string,
    rewardTxs: {
      txSignature: string,
      type: string // ex.: mint | metadataUpload etc.
    }[]
  }[],
  // TODO - Add Bridge tx history table later
}
