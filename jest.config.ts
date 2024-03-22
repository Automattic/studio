module.exports = {
	roots: [ '<rootDir>/src' ],
	transform: {
		'^.+\\.tsx?$': 'ts-jest',
	},
	testEnvironment: 'jsdom',
	testRegex: '(/tests/.*|(\\.|/)(test|spec))\\.tsx?$',
	moduleFileExtensions: [ 'ts', 'tsx', 'js', 'jsx', 'json', 'node' ],
	setupFilesAfterEnv: [ '<rootDir>/jest-setup.ts' ],
	watchPlugins: [ 'jest-watch-typeahead/filename', 'jest-watch-typeahead/testname' ],
};
