const app = require('./src/app');
const config = require('./src/config');
const { initializeHeicCapability } = require('./src/heic-decoder');

async function main() {
  await initializeHeicCapability();
  app.listen(config.port, () => {
    console.log(`PhotoDesk running at http://localhost:${config.port}`);
    console.log(`Immich URL: ${config.immichUrl}`);
  });
}

main().catch(err => {
  console.error('PhotoDesk failed to start:', err);
  process.exitCode = 1;
});
