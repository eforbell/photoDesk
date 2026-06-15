const test = require('node:test');
const assert = require('node:assert/strict');

const { responseBuffer } = require('../src/immich-client');

test('streams Immich originals through the configured byte limit', async () => {
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(6));
      controller.enqueue(new Uint8Array(6));
      controller.close();
    },
  }));
  await assert.rejects(responseBuffer(response, 10), /exceeds/i);
});
