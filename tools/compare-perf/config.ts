import path from 'path';

const metricsPath = path.resolve( __dirname, '../metrics' );
const artifactsPath = process.env.ARTIFACTS_PATH ?? path.join( metricsPath, 'artifacts' );

const config = {
	gitRepositoryURL: 'https://github.com/Automattic/studio.git',
	setupTestRunner: 'npm ci && npx playwright install chromium',
	testCommand: 'npm run test:metrics',
	setupCommand: 'npm ci && npm run package',
	testsPath: 'tools/metrics/tests',
	testFileSuffix: '.test.ts',
	artifactsPath,
	resultsFileSuffix: '.results.json',
	summaryFileSuffix: '.summary.json',
};

export default config;
