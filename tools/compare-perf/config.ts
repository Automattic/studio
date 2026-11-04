import path from 'path';

const metricsPath = path.resolve( __dirname, '../metrics' );
const artifactsPath = process.env.ARTIFACTS_PATH ?? path.join( metricsPath, 'artifacts' );

const installTestBrowsers = 'npx playwright install chromium';
const packageCommand = 'npm run package';

const config = {
	gitRepositoryURL: 'https://github.com/Automattic/studio.git',
	repositoryRoot: path.resolve( __dirname, '../..' ),
	installTestBrowsers,
	setupTestRunner: `npm ci && ${ installTestBrowsers }`,
	testCommand: 'npm run test:metrics',
	packageCommand,
	setupCommand: `npm ci && ${ packageCommand }`,
	testsPath: 'tools/metrics/tests',
	testFileSuffix: '.test.ts',
	artifactsPath,
	resultsFileSuffix: '.results.json',
	summaryFileSuffix: '.summary.json',
};

export default config;
