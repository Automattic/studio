const config = {
	gitRepositoryURL: 'https://github.com/Automattic/studio.git',
	setupTestRunner: 'npm install',
	setupCommand: 'npm install && IS_DEV_BUILD=true npm run package && npm run make',
	testsPath: '/metrics/tests',
	testCommand: 'npm run test:metrics',
};

export default config;
