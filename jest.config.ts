module.exports = {
	roots: [ '<rootDir>/src', '<rootDir>/cli' ],
	preset: 'ts-jest',
	transform: {
		'^.+\\.(ts|tsx)$': [
			'ts-jest',
			{
				diagnostics: {
					exclude: [ '**/vendor/wp-now/**/*' ],
				},
				useESM: true,
				tsconfig: {
					module: 'esnext',
				},
			},
		],
		'^.+\\.m?js$': [ 'babel-jest', { presets: [ '@babel/preset-env' ] } ],
	},
	transformIgnorePatterns: [ 'node_modules/(?!(@php-wasm|@wp-playground)/)' ],
	moduleNameMapper: {
		'^(\\.{1,2}/.*)\\.js$': '$1',
		'^cli/(.*)$': '<rootDir>/cli/$1',
		'^src/(.*)$': '<rootDir>/src/$1',
		'^vendor/(.*)$': '<rootDir>/vendor/$1',
		'^common/(.*)$': '<rootDir>/common/$1',
	},
	testEnvironment: 'jsdom',
	globals: {
		COMMIT_HASH: 'mock-hash',
		MAIN_WINDOW_WEBPACK_ENTRY: 'main-window-webpack-entry',
		MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: 'main-window-preload-webpack-entry',
	},
	testRegex: '(/tests/.*|(\\.|/)(test|spec))\\.tsx?$',
	testPathIgnorePatterns: [ '/node_modules/', 'tests/utils/', 'stores/tests/utils/' ],
	moduleFileExtensions: [ 'ts', 'tsx', 'js', 'jsx', 'json', 'node' ],
	globalSetup: '<rootDir>/jest-global-setup.ts',
	setupFilesAfterEnv: [ '<rootDir>/jest-setup.ts' ],
	watchPlugins: [ 'jest-watch-typeahead/filename', 'jest-watch-typeahead/testname' ],
	coverageDirectory: 'coverage',
	coverageReporters: [ 'json-summary', 'lcov' ],
	coveragePathIgnorePatterns: [
		'/node_modules/',
		'/tests/',
		'/vendor/',
		'jest-global-setup.ts',
		'jest-setup.ts',
	],
	coverageThreshold: {
		global: {
			statements: 0,
			branches: 0,
			functions: 0,
			lines: 0,
		},
	},
};
