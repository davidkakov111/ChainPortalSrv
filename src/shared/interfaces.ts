export interface cliEnv {
  reownProjectId: string,
  blockchainNetworks: {
    solana: {
      selected: 'devnet'|'mainnet',
      pubKey: string,
    }, 
  },
}
