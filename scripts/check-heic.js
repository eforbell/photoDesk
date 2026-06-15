#!/usr/bin/env node

const { initializeHeicCapability } = require('../src/heic-decoder');

async function main() {
  const capability = await initializeHeicCapability();
  console.log(JSON.stringify(capability, null, 2));
  if (capability.heicDecode === 'unavailable') process.exitCode = 1;
}

main().catch(err => {
  console.error(`[heic] Capability check failed: ${err.message}`);
  process.exitCode = 1;
});
