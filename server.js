const app = require('./src/app');
const config = require('./src/config');

app.listen(config.port, () => {
  console.log(`PhotoDesk running at http://localhost:${config.port}`);
  console.log(`Immich URL: ${config.immichUrl}`);
});
