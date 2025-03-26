const config = {
	gitRepositoryURL: 'https://github.com/Automattic/studio.git',
	setupTestRunner: 'npm ci --unsafe-perm --no-audit --no-progress',
	setupCommand:
		'npm ci --unsafe-perm --no-audit --no-progress && IS_DEV_BUILD=true npm run package',
	testsPath: '/metrics/tests',
	testCommand: 'npm run test:metrics',
};

export default config;
