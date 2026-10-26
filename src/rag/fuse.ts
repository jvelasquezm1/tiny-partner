/**
 * Reciprocal rank fusion: merges ranked lists without comparing their scores,
 * which live on different scales (cosine distance vs ts_rank).
 */
export function reciprocalRankFusion<T>(lists: T[][], key: (item: T) => string | number, k = 60): T[] {
  const scores = new Map<string | number, { item: T; score: number }>();
  for (const list of lists) {
    list.forEach((item, rank) => {
      const id = key(item);
      const entry = scores.get(id) ?? { item, score: 0 };
      entry.score += 1 / (k + rank + 1);
      scores.set(id, entry);
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score).map((entry) => entry.item);
}
