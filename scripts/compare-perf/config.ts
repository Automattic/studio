import path from 'path';

const metricsPath = path.resolve( __dirname, '../../metrics' );
const artifactsPath = process.env.ARTIFACTS_PATH ?? path.join( metricsPath, 'artifacts' );

const config = {
	gitRepositoryURL: 'https://github.com/Automattic/studio.git',
	setupTestRunner: 'npm ci && npx playwright install chromium',
	testCommand: 'npm run test:metrics',
	// Skip building if out directory already exists (for CI with pre-built artifacts)
	setupCommand: 'npm ci && ([ -d "out" ] && echo "Using pre-built artifacts" || IS_DEV_BUILD=true npm run package)',
	testsPath: 'metrics/tests',
	testFileSuffix: '.test.ts',
	artifactsPath,
	resultsFileSuffix: '.results.json',
	summaryFileSuffix: '.summary.json',
};

export default config;
