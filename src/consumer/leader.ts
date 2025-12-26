const toAccountParts = (value: string): number[] =>
  value
    .split('.')
    .map((part) => {
      const parsed = Number(part);
      return Number.isFinite(parsed) ? parsed : 0;
    });

export const compareAccountIds = (left: string, right: string): number => {
  const leftParts = toAccountParts(left);
  const rightParts = toAccountParts(right);
  const max = Math.max(leftParts.length, rightParts.length);
  for (let i = 0; i < max; i += 1) {
    const diff = (leftParts[i] ?? 0) - (rightParts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return left.localeCompare(right);
};

export const sortAccountIds = (ids: string[]): string[] => {
  const unique = Array.from(
    new Set(ids.map((value) => value.trim()).filter(Boolean)),
  );
  return unique.sort(compareAccountIds);
};

export const selectRoundLeader = (
  epoch: number,
  accountIds: string[],
): string | null => {
  const sorted = sortAccountIds(accountIds);
  if (sorted.length === 0) return null;
  const index = Math.abs(epoch) % sorted.length;
  return sorted[index];
};
