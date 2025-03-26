const config = {
	gitRepositoryURL: 'https://github.com/Automattic/studio.git',
	setupTestRunner: 'npm ci',
	setupCommand: 'npm ci && IS_DEV_BUILD=true npm run package',
	testsPath: '/metrics/tests',
	testCommand: 'npm run test:metrics',
};

export default config;
