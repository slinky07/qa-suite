export function canCancel(daysSincePurchase, cancellationWindowDays) {
  return cancellationWindowDays > daysSincePurchase;
}
