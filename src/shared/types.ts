export type operationType = 'mint' | 'bridge';

export type assetType = 'NFT' | 'Token';

export type blockchainSymbols = 'ETH' | 'SOL' | 'BSC' | 'MATIC' | 
  'ADA' | 'XTZ' | 'AVAX' | 'FLOW' | 'FTM' | 'ALGO';

export type blockchainFees = Partial<Record<blockchainSymbols, number>>;
