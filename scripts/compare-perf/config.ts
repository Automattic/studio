import path from 'path';

const metricsPath = path.resolve( __dirname, '../../metrics' );

const config = {
	gitRepositoryURL: 'https://github.com/Automattic/studio.git',
	setupTestRunner: 'npm ci && npx playwright install chromium',
	testCommand: 'npm run test:metrics',
	setupCommand: 'npm ci && IS_DEV_BUILD=true npm run package',
	testsPath: 'metrics/tests',
	testFileSuffix: '.test.ts',
	artifactsPath: path.join( metricsPath, 'artifacts' ),
	resultsFileSuffix: '.results.json',
	summaryFileSuffix: '.summary.json',
};

export default config;
