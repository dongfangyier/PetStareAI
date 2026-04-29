const fs = require('fs');
const path = require('path');

/**
 * Detector Manager - Auto-loads all detectors in this directory
 * Each detector must export: { id, name, detect: async(processes) => { activeCount: number } }
 */

const detectors = [];

// Auto-load all detectors in this directory (except index.js)
const detectorFiles = fs.readdirSync(__dirname).filter(file =>
  file.endsWith('.js') && file !== 'index.js'
);

for (const file of detectorFiles) {
  try {
    const detector = require(path.join(__dirname, file));
    if (detector.id && typeof detector.detect === 'function') {
      detectors.push(detector);
      console.log(`✓ Loaded detector: ${detector.name} (${detector.id})`);
    } else {
      console.warn(`⚠ Skipping invalid detector: ${file}`);
    }
  } catch (e) {
    console.error(`✗ Failed to load detector ${file}:`, e.message);
  }
}

/**
 * Run all detectors and aggregate results
 * @param {Array} processes - Parsed process list from parseProcessList
 * @returns {Object} { totalActiveCount: number, results: Array<{id, name, activeCount}> }
 */
async function detectAll(processes) {
  const results = [];
  let totalActiveCount = 0;

  for (const detector of detectors) {
    try {
      const result = await detector.detect(processes);
      const activeCount = result.activeCount || 0;
      totalActiveCount += activeCount;
      results.push({
        id: detector.id,
        name: detector.name,
        activeCount,
        message: result.message
      });
    } catch (e) {
      console.error(`Error in detector ${detector.id}:`, e);
      results.push({
        id: detector.id,
        name: detector.name,
        activeCount: 0,
        error: e.message
      });
    }
  }

  return {
    totalActiveCount,
    results
  };
}

module.exports = {
  detectors,
  detectAll
};
