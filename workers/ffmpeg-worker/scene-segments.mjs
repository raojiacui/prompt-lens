import { createHash } from "node:crypto";

const SECOND = 1_000_000;
const LIMIT = 15 * SECOND;

export function splitLongScenes(scenes, seed = JSON.stringify(scenes)) {
  return scenes.flatMap((scene) => {
    const start = Math.round(scene.start * SECOND);
    const end = Math.round(scene.end * SECOND);
    const duration = end - start;
    if (duration <= LIMIT) return [scene];

    const minimumCount = Math.ceil(duration / (10 * SECOND));
    const maximumCount = Math.floor(duration / (8 * SECOND));
    const feasible = minimumCount <= maximumCount;
    const count = feasible
      ? Math.max(minimumCount, Math.min(maximumCount, Math.round(duration / (9 * SECOND))))
      : Math.max(2, Math.round(duration / (9 * SECOND)));
    const average = duration / count;
    const minimum = feasible ? 8 * SECOND : Math.floor(average - 0.75 * SECOND);
    const maximum = feasible ? 10 * SECOND : Math.min(LIMIT, Math.ceil(average + 0.75 * SECOND));
    const result = [];
    let cursor = start;
    for (let index = 0; index < count; index += 1) {
      const remaining = count - index - 1;
      // Reserve enough time for every remaining segment, including the tail.
      const lower = Math.max(minimum, end - cursor - remaining * maximum);
      const upper = Math.min(maximum, end - cursor - remaining * minimum);
      const hash = createHash("sha256").update(`${seed}:${start}:${end}:${index}`).digest();
      const fraction = hash.readUInt32BE(0) / 0x100000000;
      const length = remaining === 0 ? end - cursor : lower + Math.floor(fraction * (upper - lower + 1));
      const next = cursor + length;
      result.push({
        ...scene,
        start: cursor / SECOND,
        end: next / SECOND,
        ...(scene.shotGroupId ? { shotGroupId: `${scene.shotGroupId}.${String(index + 1).padStart(2, "0")}` } : {}),
      });
      cursor = next;
    }
    return result;
  });
}
