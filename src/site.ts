// arc-studio-allow-onchain-literal (public deployment record: docs/DEPLOYMENTS.md)
import { getNetwork } from '@acqui/shared'

const trim = (value: string): string => value.replace(/\/+$/, '')

/** Public address of the Acqui API, used in every example a developer copies. Override at build time with VITE_PUBLIC_API_URL. */
export const PUBLIC_API_URL = trim((import.meta.env.VITE_PUBLIC_API_URL as string | undefined) ?? 'https://api.51-68-172-236.nip.io')

/** Public address of the website and hosted checkout. Override at build time with VITE_SITE_URL. */
export const SITE_BASE_URL = trim((import.meta.env.VITE_SITE_URL as string | undefined) ?? 'https://acqui.pages.dev')

const mainnet = getNetwork('arc-mainnet')

/** Arc mainnet facts and the Acqui contracts, all public and checkable on the explorer. */
export const ARC_MAINNET = {
  name: 'Arc mainnet',
  chainId: mainnet.chainId,
  explorer: 'https://explorer.arc.io',
  usdc: mainnet.usdcErc20,
  paymentContract: '0xdb03b5D5738E44E873bcC0fA7b75A27C3Bf10418',
  factoryContract: '0x17CEbb877c79b8c75787be551B30ee6FC82CADEd',
  feeRecipient: '0x78b96a800a3a6cd349cb2b0016148F20621cd00F',
} as const

export const explorerAddress = (address: string): string => `${ARC_MAINNET.explorer}/address/${address}`
