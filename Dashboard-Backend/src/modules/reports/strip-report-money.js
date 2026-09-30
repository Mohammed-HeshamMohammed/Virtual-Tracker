const MONEY_FIELDS = ["spentAmount", "currency", "originalAmount", "originalCurrency", "rateAsOf"];

function withoutMoney(row) {
  const out = { ...row };
  for (const field of MONEY_FIELDS) delete out[field];
  return out;
}

/**
 * The Time & Activity payload with every monetary field removed and
 * `moneyHidden` set, so the client app knows to drop the Total spent column,
 * card and chart rather than render a misleading zero. Used for viewers who
 * are never allowed to see pay (the Client role).
 */
export function stripReportMoney(payload) {
  const { currency: _currency, ...rest } = payload;
  return {
    ...rest,
    moneyHidden: true,
    days: (payload.days ?? []).map((day) => ({ ...day, members: (day.members ?? []).map(withoutMoney) })),
    entries: (payload.entries ?? []).map(withoutMoney),
  };
}
