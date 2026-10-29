export type Availability = 'live' | 'planned' | 'exploring'

export type PaymentCapability = {
  id: string
  asset: string
  network: string
  availability: Availability
  settlementAsset: 'USDC'
  settlementNetwork: 'arc'
  displayStatus: 'Live' | 'Coming soon' | 'Planned' | 'Exploring'
}

export const PAYMENT_CAPABILITIES: readonly PaymentCapability[] = [
  { id: 'usdc-arc', asset: 'USDC', network: 'Arc', availability: 'live', settlementAsset: 'USDC', settlementNetwork: 'arc', displayStatus: 'Live' },
  { id: 'usdc-base', asset: 'USDC', network: 'Base', availability: 'planned', settlementAsset: 'USDC', settlementNetwork: 'arc', displayStatus: 'Coming soon' },
  { id: 'usdc-ethereum', asset: 'USDC', network: 'Ethereum', availability: 'planned', settlementAsset: 'USDC', settlementNetwork: 'arc', displayStatus: 'Coming soon' },
  { id: 'eth-ethereum', asset: 'ETH', network: 'Ethereum', availability: 'planned', settlementAsset: 'USDC', settlementNetwork: 'arc', displayStatus: 'Planned' },
  { id: 'eth-base', asset: 'ETH', network: 'Base', availability: 'planned', settlementAsset: 'USDC', settlementNetwork: 'arc', displayStatus: 'Planned' },
  { id: 'usdc-solana', asset: 'USDC', network: 'Solana', availability: 'exploring', settlementAsset: 'USDC', settlementNetwork: 'arc', displayStatus: 'Exploring' },
  { id: 'sol-solana', asset: 'SOL', network: 'Solana', availability: 'exploring', settlementAsset: 'USDC', settlementNetwork: 'arc', displayStatus: 'Exploring' },
  { id: 'usdt-selected', asset: 'USDT', network: 'Selected networks', availability: 'exploring', settlementAsset: 'USDC', settlementNetwork: 'arc', displayStatus: 'Exploring' },
]

export const LIVE_PAYMENT_CAPABILITY = PAYMENT_CAPABILITIES.find((item) => item.availability === 'live')!

