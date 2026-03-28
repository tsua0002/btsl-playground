/**
 * Map schema `calc` fee lines to the FEERATE param name and align bound params with PSBT-implicit fee.
 * Example (PUBKEY_SPEND): fees = vSize(CURRENT_PSBT) * @FEE_RATE
 */

import type { BTSLSchema, BoundParams } from './types';
import { FEE_BUDGET_VSIZE_SLACK_VB } from './types';

/**
 * If `calc` defines `fees = vSize(CURRENT_PSBT) * @PARAM` (or `@PARAM * vSize(...)`), return PARAM.
 */
export function parseFeerateParamFromVsizeProduct(schema: BTSLSchema): string | null {
  const feesLine = schema.calc.find((c) => c.variable === 'fees');
  if (!feesLine) return null;
  const e = feesLine.expression.replace(/\s+/g, ' ').trim();
  const m1 = /^vSize\s*\(\s*CURRENT_PSBT\s*\)\s*\*\s*@([A-Za-z][A-Za-z0-9_]*)\s*$/i.exec(e);
  if (m1) return m1[1];
  const m2 = /^@\s*([A-Za-z][A-Za-z0-9_]*)\s*\*\s*vSize\s*\(\s*CURRENT_PSBT\s*\)\s*$/i.exec(e);
  if (m2) return m2[1];
  return null;
}

/**
 * When the schema ties `fees` to `vSize * @PARAM`, set PARAM from the PSBT’s implicit fee:
 * `implicitFee / (vsize + fee slack vB)` must be an integer (sat/vB).
 */
export function boundParamsWithPsbtImpliedFeerate(
  schema: BTSLSchema,
  boundParams: BoundParams,
  vsize: number,
  implicitFee: bigint,
  log: (s: string) => void
): BoundParams {
  const paramName = parseFeerateParamFromVsizeProduct(schema);
  if (!paramName) return boundParams;

  const denom = BigInt(vsize + FEE_BUDGET_VSIZE_SLACK_VB);
  if (denom <= BigInt(0) || implicitFee <= BigInt(0)) return boundParams;

  if (implicitFee % denom !== BigInt(0)) {
    log(
      `[checker] Implicit fee ${implicitFee} sats is not an integer multiple of (vsize+${FEE_BUDGET_VSIZE_SLACK_VB})=${denom} vB — replay uses bound @${paramName} from UI/.params`
    );
    return boundParams;
  }

  const rate = implicitFee / denom;
  if (rate <= BigInt(0) || rate > BigInt(1_000_000)) return boundParams;

  const n = Number(rate);
  if (!Number.isSafeInteger(n)) return boundParams;

  const prev = boundParams[paramName];
  log(
    `[checker] @${paramName} for replay from schema fee rule × PSBT: ${n} sat/vB (implicit fee ${implicitFee} sats ÷ ${denom} vB)`
  );
  return {
    ...boundParams,
    [paramName]: {
      type: prev?.type ?? 'FEERATE',
      rawValue: String(n),
      resolved: n,
      ...(prev?.payloadAsText !== undefined ? { payloadAsText: prev.payloadAsText } : {}),
    },
  };
}
