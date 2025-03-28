import { assetType, blockchainSymbols, operationType } from "./types"

export interface cliEnv {
  reownProjectId: string,
  blockchainNetworks: {
    solana: {
      selected: 'devnet'|'mainnet'
    }, 
    ethereum: {
      selected: 'sepolia'|'mainnet'
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
  mediaContentType: string;              // Media content type
  symbol?: string;                       // Symbol of the NFT
  attributes?: Array<Attribute>;         // Array of attributes for the NFT
  creator?: string;                      // Optional creator information
  isLimitedEdition?: boolean;            // Checkbox for limited edition
  totalEditions?: number;                // Total editions, optional when not limited edition
  editionNumber?: number;                // Edition number, optional when not limited edition
  royalty?: number;                      // Royalty percentage (0 to 100)
  tags?: string[];                       // Array of tags
  license?: string;                      // Optional license information
  externalLink?: string;                 // Optional external link
  creationTimestampToggle?: boolean;     // Toggle for including timestamp
  creationTimestamp?: string;            // Timestamp in ISO format (optional)
}
export interface Attribute {
  type: string;                         // Type of the attribute (e.g., Color)
  value: string;                        // Value of the attribute (e.g., Red)
}

export interface TokenMetadata {
  name: string;                          // Name of the token
  symbol: string;                        // Symbol of the token
  media: Uint8Array | null;              // Media file (can be an image, video, etc.)
  supply?: number;                       // Total supply of the token
  decimals?: number;                     // How many decimal places should the token have
  description?: string;                  // Description of the token
  externalLink?: string;                 // Optional external link
  mediaName: string;                     // Media file name
  mediaContentType: string;              // Media content type
}

export interface feedback {
  rating: number, 
  feedback: string, 
  afterUse: boolean, 
  ip: any
}