import { z } from 'zod';
import { addressSchema, usdcAmountSchema, USDC_ONE } from '@acqui/shared';

/** Operational ceiling for the MVP (not a contract limit): 100,000 USDC per payment. */
export const MAX_PAYMENT_UNITS = 100_000n * USDC_ONE;

const printable = (max: number) => z.string().min(1).max(max).regex(/^[^\u0000-\u001f\u007f]+$/, 'must not contain control characters');

export const createPaymentIntentSchema = z
  .object({
    amount: usdcAmountSchema.refine((v) => v <= MAX_PAYMENT_UNITS, 'Maximum payment is 100000 USDC'),
    currency: z.literal('USDC'),
    network: z.literal('arc'),
    order_id: printable(128),
    description: printable(500).optional(),
    success_url: z.string().max(2048).optional(),
    cancel_url: z.string().max(2048).optional(),
    refund_address: addressSchema.optional(),
  })
  .strict();
export type CreatePaymentIntentInput = z.infer<typeof createPaymentIntentSchema>;

export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_\-:.]{8,128}$/, 'Idempotency-Key must be 8-128 URL-safe characters');

export const listPaymentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
  status: z
    .enum(['created', 'awaiting_payment', 'deposit_detected', 'verifying', 'settling', 'settled', 'expired', 'underpaid', 'recovery_required', 'retryable_failure'])
    .optional(),
});

export const createMerchantSchema = z.object({ display_name: z.string().trim().min(2).max(80) }).strict();

export const updateMerchantSchema = z
  .object({
    display_name: z.string().trim().min(2).max(80).optional(),
    allowed_return_origin: z.string().max(2048).nullable().optional(),
    webhook_url: z.string().max(2048).nullable().optional(),
  })
  .strict();

export const initialPayoutSchema = z
  .object({
    payout_address: addressSchema,
    /** Typed a second time so the merchant explicitly reviews the exact address. */
    confirm_address: addressSchema,
    acknowledge: z.literal(true),
  })
  .strict()
  .refine((v) => v.payout_address === v.confirm_address, { message: 'confirm_address must match payout_address', path: ['confirm_address'] });

export const payoutChangeRequestSchema = z.object({ new_address: addressSchema }).strict();
export const payoutChangeConfirmSchema = z.object({ token: z.string().min(20).max(200) }).strict();

export const createApiKeySchema = z.object({ label: z.string().trim().min(1).max(60) }).strict();
export const rotateApiKeySchema = z
  .object({ grace_seconds: z.number().int().min(0).max(86_400).default(0) })
  .strict()
  .default({ grace_seconds: 0 });
