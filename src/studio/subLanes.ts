/**
 * Assigns sub-lane indices (0, 1, 2...) to timeline items based on time intervals
 * so overlapping clips stack neatly into separate vertical rows instead of covering each other.
 */
export function assignSubLanes<T extends { startTimeSec: number; durationSec: number }>(
  items: T[]
): (T & { lane: number })[] {
  if (items.length === 0) return [];

  const indexed = items.map((item, originalIndex) => ({ item, originalIndex }));
  indexed.sort((a, b) => a.item.startTimeSec - b.item.startTimeSec);

  const laneEnds: number[] = [];
  const result: (T & { lane: number })[] = new Array(items.length);

  for (const { item, originalIndex } of indexed) {
    const start = item.startTimeSec;
    const end = start + item.durationSec;
    let assignedLane = -1;

    for (let l = 0; l < laneEnds.length; l++) {
      if (start >= laneEnds[l] - 0.05) {
        assignedLane = l;
        laneEnds[l] = end;
        break;
      }
    }

    if (assignedLane === -1) {
      assignedLane = laneEnds.length;
      laneEnds.push(end);
    }

    result[originalIndex] = { ...item, lane: assignedLane };
  }

  return result;
}
