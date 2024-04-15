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
	testRegex: '(/tests/.*|(\\.|/)(test|spec))\\.tsx?$',
	moduleFileExtensions: [ 'ts', 'tsx', 'js', 'jsx', 'json', 'node' ],
	globalSetup: '<rootDir>/jest-global-setup.ts',
	setupFilesAfterEnv: [ '<rootDir>/jest-setup.ts' ],
	watchPlugins: [ 'jest-watch-typeahead/filename', 'jest-watch-typeahead/testname' ],
};
