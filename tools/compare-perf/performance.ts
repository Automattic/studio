/* eslint-disable no-console */
import fs from 'fs';
import os from 'os';
import path from 'path';
import chalk from 'chalk';
import { simpleGit } from 'simple-git';
import config from './config';
import { runShellScript, readJSONFile, askForConfirmation, getFilesFromDir } from './utils';

const formats = {
	title: chalk.bold,
	error: chalk.bold.red,
	warning: chalk.bold.hex( '#FFA500' ),
	success: chalk.bold.green,
};

interface PerformanceCommandOptions {
	/**
	 * Run on CI.
	 */
	ci?: boolean;
	/**
	 * Run each test suite this many times for each branch.
	 */
	rounds?: number;
	/**
	 * The branch whose performance test files will be used for testing.
	 */
	testsBranch?: string;
}

/**
 * A logging helper for printing steps and their substeps.
 *
 * @param indent Value to indent the log.
 * @param msg    Message to log.
 * @paramargs   Rest of the arguments to pass to console.log.
 */
function logAtIndent( indent: number, msg: string, ...args: string[] ) {
	const prefix = indent === 0 ? '▶ ' : '> ';
	const newline = indent === 0 ? '\n' : '';
	return console.log( newline + '    '.repeat( indent ) + prefix + msg, ...args );
}

/**
 * Sanitizes branch name to be used in a path or a filename.
 *
 * @param branch
 *
 * @return Sanitized branch name.
 */
function sanitizeBranchName( branch: string ): string {
	return branch.replace( /[^a-zA-Z0-9-]/g, '-' );
}

/**
 * Computes the median number from an array numbers.
 *
 * @param array
 *
 * @return Median value or undefined if array empty.
 */
function median( array: number[] ): number | undefined {
	if ( ! array || ! array.length ) return undefined;

	const numbers = [ ...array ].sort( ( a, b ) => a - b );
	const middleIndex = Math.floor( numbers.length / 2 );

	if ( numbers.length % 2 === 0 ) {
		return ( numbers[ middleIndex - 1 ] + numbers[ middleIndex ] ) / 2;
	}
	return numbers[ middleIndex ];
}

/**
 * Runs the performance tests on the current branch.
 *
 * @param testSuite     Name of the tests set.
 * @param testRunnerDir Path to the performance tests' clone.
 * @param runKey        Unique identifier for the test run.
 * @param branchDir     Path to the branch's clone.
 */
async function runTestSuite(
	testSuite: string,
	testRunnerDir: string,
	runKey: string,
	branchDir: string
) {
	const outDir = path.join( branchDir, 'apps', 'studio', 'out' );
	if ( ! fs.existsSync( outDir ) ) {
		throw new Error( `Could not find packaged Studio build output at: ${ outDir }` );
	}
	const testRunnerOutDir = path.join( testRunnerDir, 'apps', 'studio', 'out' );

	if ( fs.existsSync( testRunnerOutDir ) ) {
		fs.rmSync( testRunnerOutDir, { recursive: true } );
	}
	fs.mkdirSync( path.dirname( testRunnerOutDir ), { recursive: true } );
	fs.symlinkSync( outDir, testRunnerOutDir, 'dir' );

	// Run the test suite
	await runShellScript( `${ config.testCommand } ${ testSuite }`, testRunnerDir, {
		...process.env,
		ARTIFACTS_PATH: config.artifactsPath,
		RESULTS_FILE_SUFFIX: config.resultsFileSuffix,
		RESULTS_ID: runKey,
	} );
}

/**
 * Runs the performances tests on an array of branches and output the result.
 *
 * @param branches Branches to compare
 * @param options  Command options.
 */
export async function runPerformanceTests(
	branches: string[],
	options: PerformanceCommandOptions
) {
	const runningInCI = !! process.env.CI || !! options.ci;
	const testRounds = options.rounds || 1;

	// The default value doesn't work because commander provides an array.
	if ( branches.length === 0 ) {
		branches = [ 'trunk' ];
	}

	console.log( formats.title( '\n💃 Performance Tests 🕺' ) );
	console.log(
		'\nWelcome! This tool runs the performance tests on multiple branches and displays a comparison table.'
	);

	if ( ! runningInCI ) {
		await askForConfirmation( 'Ready to go? ' );
	}

	logAtIndent( 0, 'Setting up' );

	/**
	 * @type {string[]} git refs against which to run tests;
	 *                  could be commit SHA, branch name, tag, etc...
	 */
	if ( branches.length < 2 ) {
		throw new Error( `Need at least two git refs to run` );
	}

	const tmpDir =
		process.platform === 'win32'
			? path.join( process.env.USERPROFILE || os.homedir(), 'AppData', 'Local', 'Temp' )
			: os.tmpdir();
	const baseDir = path.join( tmpDir, 'studio-performance-tests' );

	if ( fs.existsSync( baseDir ) ) {
		logAtIndent( 1, 'Removing existing files' );
		fs.rmSync( baseDir, { recursive: true } );
	}

	logAtIndent( 1, 'Creating base directory:', formats.success( baseDir ) );
	fs.mkdirSync( baseDir );

	logAtIndent( 1, 'Setting up repository' );
	const sourceDir = path.join( baseDir, 'source' );

	logAtIndent( 2, 'Creating directory:', formats.success( sourceDir ) );
	fs.mkdirSync( sourceDir );

	const sourceGit = simpleGit( sourceDir );
	logAtIndent( 2, 'Initializing:', formats.success( config.gitRepositoryURL ) );
	await sourceGit.raw( 'init' ).raw( 'remote', 'add', 'origin', config.gitRepositoryURL );

	for ( const [ i, branch ] of branches.entries() ) {
		logAtIndent(
			2,
			`Fetching environment branch (${ i + 1 } of ${ branches.length }):`,
			formats.success( branch )
		);
		await sourceGit.raw( 'fetch', '--depth=1', 'origin', branch );
	}

	const testRunnerBranch = options.testsBranch || branches[ 0 ];
	if ( options.testsBranch && ! branches.includes( options.testsBranch ) ) {
		logAtIndent( 2, 'Fetching test runner branch:', formats.success( options.testsBranch ) );
		await sourceGit.raw( 'fetch', '--depth=1', 'origin', options.testsBranch );
	} else {
		logAtIndent( 2, 'Using test runner branch:', formats.success( testRunnerBranch ) );
	}

	logAtIndent( 1, 'Setting up test runner' );

	const testRunnerDir = path.join( baseDir, 'tests' );

	logAtIndent( 2, 'Copying source to:', formats.success( testRunnerDir ) );
	fs.cpSync( sourceDir, testRunnerDir, { recursive: true } );

	logAtIndent( 2, 'Checking out branch:', formats.success( testRunnerBranch ) );
	await simpleGit( testRunnerDir ).raw( 'checkout', testRunnerBranch );

	logAtIndent( 2, 'Installing dependencies and building' );

	await runShellScript( config.setupTestRunner, testRunnerDir, {
		GITHUB_TOKEN: process.env.GITHUB_TOKEN,
	} );

	logAtIndent( 1, 'Setting up test environments' );

	const envsDir = path.join( baseDir, 'environments' );
	logAtIndent( 2, 'Creating parent directory:', formats.success( envsDir ) );
	fs.mkdirSync( envsDir );

	const branchDirs: Record< string, string > = {};
	for ( const branch of branches ) {
		logAtIndent( 2, 'Branch:', formats.success( branch ) );
		const sanitizedBranchName = sanitizeBranchName( branch );
		const envDir = path.join( envsDir, sanitizedBranchName );

		logAtIndent( 3, 'Creating directory:', formats.success( envDir ) );
		fs.mkdirSync( envDir );
		branchDirs[ branch ] = envDir;
		const buildDir = path.join( envDir, 'app' );

		logAtIndent( 3, 'Copying source to:', formats.success( buildDir ) );
		fs.cpSync( sourceDir, buildDir, { recursive: true } );

		logAtIndent( 3, 'Checking out:', formats.success( branch ) );
		await simpleGit( buildDir ).raw( 'checkout', branch );

		logAtIndent( 3, 'Installing dependencies and building' );
		await runShellScript( config.setupCommand, buildDir, {
			GITHUB_TOKEN: process.env.GITHUB_TOKEN,
			SKIP_WORKER_THREAD_BUILD: process.env.SKIP_WORKER_THREAD_BUILD,
			IS_DEV_BUILD: 'true',
		} );
	}

	logAtIndent( 0, 'Looking for test files' );

	const testSuites = getFilesFromDir( path.join( testRunnerDir, config.testsPath ) ).map(
		( file: string ) => {
			logAtIndent( 1, 'Found:', formats.success( file ) );
			return path.basename( file, config.testFileSuffix );
		}
	);

	logAtIndent( 0, 'Running tests' );

	for ( const testSuite of testSuites ) {
		for ( let i = 1; i <= testRounds; i++ ) {
			logAtIndent(
				1,
				// prettier-ignore
				`Suite: ${ formats.success( testSuite ) } (round ${ i } of ${ testRounds })`
			);

			for ( const branch of branches ) {
				logAtIndent( 2, 'Branch:', formats.success( branch ) );
				const sanitizedBranchName = sanitizeBranchName( branch );
				const runKey = `${ testSuite }_${ sanitizedBranchName }_round-${ i }`;

				logAtIndent( 3, 'Running tests' );
				await runTestSuite(
					testSuite,
					testRunnerDir,
					runKey,
					path.join( branchDirs[ branch ], 'app' )
				);
			}
		}
	}

	logAtIndent( 0, 'Calculating results' );

	const resultFiles = getFilesFromDir( config.artifactsPath ).filter( ( file: string ) =>
		file.endsWith( config.resultsFileSuffix )
	);

	/** @type {Record<string,Record<string, Record<string, number>>>} */
	const results: Record< string, Record< string, Record< string, number > > > = {};

	// Calculate medians from all rounds.
	for ( const testSuite of testSuites ) {
		logAtIndent( 1, 'Test suite:', formats.success( testSuite ) );

		results[ testSuite ] = {};
		for ( const branch of branches ) {
			const sanitizedBranchName = sanitizeBranchName( branch );
			const resultsRounds = resultFiles
				.filter( ( file: string ) =>
					file.includes( `${ testSuite }_${ sanitizedBranchName }_round-` )
				)
				.map( ( file: string ) => {
					logAtIndent( 2, 'Reading from:', formats.success( file ) );
					return readJSONFile( file );
				} );

			const metrics = Object.keys( resultsRounds[ 0 ] );
			results[ testSuite ][ branch ] = {};

			for ( const metric of metrics ) {
				const values = resultsRounds
					.map( ( round: Record< string, number > ) => round[ metric ] )
					.filter( ( value: number ) => typeof value === 'number' );

				const value = median( values );
				if ( value !== undefined ) {
					results[ testSuite ][ branch ][ metric ] = value;
				}
			}
		}
		const calculatedResultsPath = path.join(
			config.artifactsPath,
			testSuite + config.summaryFileSuffix
		);

		logAtIndent( 2, 'Saving curated results to:', formats.success( calculatedResultsPath ) );
		fs.writeFileSync( calculatedResultsPath, JSON.stringify( results[ testSuite ], null, 2 ) );
	}

	logAtIndent( 0, 'Printing results' );

	for ( const testSuite of testSuites ) {
		logAtIndent( 0, formats.success( testSuite ) );

		// Invert the results so we can display them in a table.
		/** @type {Record<string, Record<string, string>>} */
		const invertedResult: Record< string, Record< string, string > > = {};
		for ( const [ branch, metrics ] of Object.entries( results[ testSuite ] ) ) {
			for ( const [ metric, value ] of Object.entries( metrics ) ) {
				invertedResult[ metric ] = invertedResult[ metric ] || {};
				invertedResult[ metric ][ branch ] = `${ value } ms`;
			}
		}

		// Print the results.
		console.table( invertedResult );
	}
}
