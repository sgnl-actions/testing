export default {
  testEnvironment: 'node',
  transform: {},
  testMatch: [
    '**/tests/**/*.test.js',
    '**/tests/**/*.test.mjs'
  ],
  moduleFileExtensions: ['js', 'mjs', 'cjs', 'json'],
  moduleNameMapper: {
    '^@mswjs/interceptors/presets/node$': '<rootDir>/tests/__mocks__/mswjs-interceptors-node.cjs'
  },
  collectCoverageFrom: [
    'src/**/*.mjs',
    '!src/index.mjs',
    '!src/cli/init.mjs'
  ]
};
