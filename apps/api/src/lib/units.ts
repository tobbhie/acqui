/** Integer USDC base units (6 decimals) <-> decimal strings at the API boundary. */

/** At least two decimals, at most six, no float math: 10_000_000n -> "10.00", 1_500_000n -> "1.50", 1n -> "0.000001". */
export function unitsToDecimal(units: bigint): string {
  const whole = units / 1_000_000n;
  const frac = (units % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${whole}.${frac}`;
}

export function toUnits(value: string | number | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}
