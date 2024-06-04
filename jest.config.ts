module.exports = {
	roots: [ '<rootDir>/src' ],
	transform: {
		'^.+\\.tsx?$': [
			'ts-jest',
			{
				diagnostics: {
					exclude: [ '**/vendor/wp-now/**/*' ],
				},
			},
		],
	},
	testEnvironment: 'jsdom',
	globals: {
		COMMIT_HASH: 'mock-hash',
		MAIN_WINDOW_WEBPACK_ENTRY: 'main-window-webpack-entry',
		MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: 'main-window-preload-webpack-entry',
	},
	testRegex: '(/tests/.*|(\\.|/)(test|spec))\\.tsx?$',
	moduleFileExtensions: [ 'ts', 'tsx', 'js', 'jsx', 'json', 'node' ],
	globalSetup: '<rootDir>/jest-global-setup.ts',
	setupFilesAfterEnv: [ '<rootDir>/jest-setup.ts' ],
	watchPlugins: [ 'jest-watch-typeahead/filename', 'jest-watch-typeahead/testname' ],
	moduleNameMapper: {
		'^react-markdown$': '<rootDir>/src/__mocks__/react-markdown.tsx',
	},
};
