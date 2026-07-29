export function canCancel(daysSincePurchase, cancellationWindowDays) {
  return daysSincePurchase <= cancellationWindowDays;
}
