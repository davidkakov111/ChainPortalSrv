import { assetType, blockchainSymbols, operationType } from "./types"

export interface cliEnv {
  reownProjectId: string,
  blockchainNetworks: {
    solana: {
      selected: 'devnet'|'mainnet'
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

export interface NftMetadata {
  title: string;                         // Title of the NFT
  description: string;                   // Description of the NFT
  media: Uint8Array | null;              // Media file (can be an image, video, etc.)
  mediaName: string;                     // Media file name
  symbol: string;                        // Symbol of the NFT
  attributes: Array<Attribute>;          // Array of attributes for the NFT
  creator?: string;                      // Optional creator information
  isLimitedEdition: boolean;             // Checkbox for limited edition
  totalEditions?: number;                // Total editions, optional when not limited edition
  editionNumber?: number;                // Edition number, optional when not limited edition
  royalty: number;                       // Royalty percentage (0 to 100)
  tags: string[];                        // Array of tags
  license?: string;                      // Optional license information
  externalLink?: string;                 // Optional external link
  creationTimestampToggle: boolean;      // Toggle for including timestamp
  creationTimestamp: string;             // Timestamp in ISO format (optional)
}
interface Attribute {
  type: string;                         // Type of the attribute (e.g., Color)
  value: string;                        // Value of the attribute (e.g., Red)
}