import { z } from 'zod';
import { getAddress, isAddress } from 'viem';
import { parseUsdc } from '../../../src/onchain-money';
import { MIN_PAYMENT_AMOUNT } from './policy';
import type { Address } from './types';

export const addressSchema = z
  .string()
  .refine((value) => isAddress(value, { strict: false }), 'Invalid EVM address')
  .transform((value): Address => getAddress(value));

/** Decimal USDC string such as "12.50". Parsed with exact integer math, 6 decimals max. */
export const usdcAmountSchema = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, 'Amount must be a decimal USDC string with at most 6 decimals')
  .transform((value) => parseUsdc(value))
  .refine((value) => value >= MIN_PAYMENT_AMOUNT, 'Minimum payment is 1 USDC');

export const createPaymentIntentRequestSchema = z.object({
  amount: usdcAmountSchema,
  reference: z.string().min(1).max(128).optional(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});
export type CreatePaymentIntentRequest = z.infer<typeof createPaymentIntentRequestSchema>;

export const createMerchantRequestSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
});

export const setPayoutAddressRequestSchema = z.object({ payoutAddress: addressSchema });

export const webhookConfigRequestSchema = z.object({
  webhookUrl: z.string().url().startsWith('https://').nullable(),
  returnOrigin: z.string().url().nullable(),
});
