export function computeImpactBps(
  netQty: number,
  barVolume: number,
  impactKBps: number,
  impactCapBps: number | undefined,
  liquidityMultiplier: number,
  minLiquidity: number,
): number {
  if (netQty === 0) {
    return 0;
  }
  const liq = Math.max(minLiquidity, barVolume * liquidityMultiplier);
  if (liq <= 0) {
    return 0;
  }
  const flowRatio = Math.abs(netQty) / liq;
  let impactBps = impactKBps * flowRatio;
  if (impactCapBps !== undefined) {
    impactBps = Math.min(impactCapBps, impactBps);
  }
  return impactBps;
}

export function computeUniformExecPrice(
  openPrice: number,
  netQty: number,
  config: {
    slippage_bps: number;
    impact_k_bps: number;
    impact_cap_bps?: number;
    liquidity_multiplier: number;
    min_liquidity: number;
  },
  barVolume: number,
): { exec_price: number; impact_bps: number } {
  if (netQty === 0) {
    return { exec_price: openPrice, impact_bps: 0 };
  }
  const impactBps = computeImpactBps(
    netQty,
    barVolume,
    config.impact_k_bps,
    config.impact_cap_bps,
    config.liquidity_multiplier,
    config.min_liquidity,
  );
  const sign = netQty > 0 ? 1 : -1;
  const totalBps = config.slippage_bps + impactBps;
  return {
    exec_price: openPrice * (1 + (sign * totalBps) / 10_000),
    impact_bps: impactBps,
  };
}

export function computeFee(
  absDeltaQty: number,
  execPrice: number,
  takerFeeBps: number,
): number {
  return absDeltaQty * execPrice * (takerFeeBps / 10_000);
}
