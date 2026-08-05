/** 点数内訳バーの最大値に対する表示割合を計算する。 */
export function calculateScoreBarPercentage(
  totalPoints: number,
  maximumPoints: number,
): number {
  if (Number.isFinite(totalPoints) === false || totalPoints <= 0) {
    throw new Error("点数内訳の合計が正の有限値ではありません。");
  }
  if (Number.isFinite(maximumPoints) === false || maximumPoints <= 0) {
    throw new Error("点数内訳バーの最大値が正の有限値ではありません。");
  }
  if (totalPoints > maximumPoints) {
    throw new Error("点数内訳の合計がバーの最大値を超えています。");
  }

  return (totalPoints / maximumPoints) * 100;
}
