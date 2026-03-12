import { writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { getMetricConfig } from './metric-config';
import type { Reporter, FullResult, TestCase, TestResult } from '@playwright/test/reporter';

export type PerformanceResults = Record< string, number >;

if ( ! process.env.ARTIFACTS_PATH ) {
	throw new Error( 'ARTIFACTS_PATH is not set' );
}

class PerformanceReporter implements Reporter {
	private results: Record< string, PerformanceResults >;

	constructor() {
		this.results = {};
	}

	onTestEnd( test: TestCase, result: TestResult ): void {
		for ( const attachment of result.attachments ) {
			if ( attachment.name !== 'results' ) {
				continue;
			}

			if ( ! attachment.body ) {
				throw new Error( 'Empty results attachment' );
			}

			const testSuite = path.basename( test.location.file, '.test.ts' );
			const resultsId = process.env.RESULTS_ID || testSuite;
			const resultsPath = process.env.ARTIFACTS_PATH as string;
			const resultsBody = attachment.body.toString();
			const resultsFileSuffix = process.env.RESULTS_FILE_SUFFIX || '.results.json';
			const results = JSON.parse( resultsBody );

			if ( ! existsSync( resultsPath ) ) {
				mkdirSync( resultsPath, { recursive: true } );
			}
			writeFileSync( path.join( resultsPath, resultsId + resultsFileSuffix ), resultsBody );

			this.results[ testSuite ] = results;
		}
	}

	onEnd( result: FullResult ) {
		if ( result.status !== 'passed' ) {
			return;
		}

		if ( process.env.CI ) {
			return;
		}

		// Print the results.
		for ( const [ testSuite, results ] of Object.entries( this.results ) ) {
			const printableResults: Record< string, { value: string } > = {};

			for ( const [ key, value ] of Object.entries( results ) ) {
				printableResults[ key ] = { value: getMetricConfig( key ).format( value ) };
			}

			console.log( `\n${ testSuite }\n` );

			console.table( printableResults );
		}
	}
}

export default PerformanceReporter;
