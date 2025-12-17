module.exports = {
	roots: [ '<rootDir>/src', '<rootDir>/cli', '<rootDir>/common' ],
	preset: 'ts-jest',
	workerIdleMemoryLimit: '1GB',
	transform: {
		'^.+\\.(ts|tsx)$': [
			'ts-jest',
			{
				useESM: true,
				tsconfig: {
					module: 'esnext',
				},
			},
		],
		'^.+\\.m?js$': [ 'babel-jest', { presets: [ '@babel/preset-env' ] } ],
		"^.+\\.svg$": 'jest-transform-stub',
	},
	transformIgnorePatterns: [ 'node_modules/(?!(@php-wasm|@wp-playground)/)' ],
	moduleNameMapper: {
		'^(\\.{1,2}/.*)\\.js$': '$1',
		'^cli/(.*)$': '<rootDir>/cli/$1',
		'^src/(.*)$': '<rootDir>/src/$1',
		'^vendor/(.*)$': '<rootDir>/vendor/$1',
		'^common/(.*)$': '<rootDir>/common/$1',
		'\\.css$': '<rootDir>/src/tests/utils/style-mock.js',
	},
	testEnvironment: 'jsdom',
	testEnvironmentOptions: {
		customExportConditions: [ 'node', 'node-addons' ],
	},
	testRegex: '(/tests/.*|(\\.|/)(test|spec))\\.tsx?$',
	testPathIgnorePatterns: [ '/node_modules/', 'tests/utils/', 'stores/tests/utils/' ],
	moduleFileExtensions: [ 'ts', 'tsx', 'js', 'jsx', 'json', 'node' ],
	globalSetup: '<rootDir>/jest-global-setup.ts',
	setupFilesAfterEnv: [ '<rootDir>/jest-setup.ts' ],
	watchPlugins: [ 'jest-watch-typeahead/filename', 'jest-watch-typeahead/testname' ],
	logHeapUsage: true,
};
