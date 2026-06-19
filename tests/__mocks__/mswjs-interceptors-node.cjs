// Shim for nock v14 + Jest ESM compatibility.
// nock uses: const { default: nodeInterceptors } = require('@mswjs/interceptors/presets/node')
// but the CJS export is the array directly (module.exports = [...]), not { default: [...] }.
// This shim re-exports with a .default property so the destructuring works.
const path = require('path');
const interceptors = require(path.resolve(__dirname, '../../node_modules/@mswjs/interceptors/lib/node/presets/node.cjs'));
module.exports = interceptors;
module.exports.default = interceptors;
