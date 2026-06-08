/**
 * Group assets into scenes by time proximity.
 * Assets must have fileCreatedAt (ISO 8601 string).
 * Returns array of arrays (each inner array = one scene).
 */
function clusterByTime(assets, thresholdSeconds = 30) {
  if (!assets || assets.length === 0) return [];

  // Sort by fileCreatedAt ascending
  const sorted = [...assets].sort((a, b) => {
    return new Date(a.fileCreatedAt).getTime() - new Date(b.fileCreatedAt).getTime();
  });

  const scenes = [];
  let currentScene = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    const prevTime = new Date(prev.fileCreatedAt).getTime();
    const currTime = new Date(curr.fileCreatedAt).getTime();
    const gapSeconds = (currTime - prevTime) / 1000;

    if (gapSeconds <= thresholdSeconds) {
      currentScene.push(curr);
    } else {
      scenes.push(currentScene);
      currentScene = [curr];
    }
  }

  scenes.push(currentScene);
  return scenes;
}

module.exports = { clusterByTime };
