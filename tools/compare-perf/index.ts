#!/usr/bin/env node
/* eslint-disable no-console */

import { Command } from 'commander';
import { runPerformanceTests } from './performance';

const program = new Command();

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
const catchException = ( command: Function ) => {
	return async ( ...args: unknown[] ) => {
		try {
			await command( ...args );
		} catch ( error ) {
			console.error( error );
			process.exitCode = 1;
		}
	};
};

program
	.command( 'compare-performance [branches...]' )
	.alias( 'perf' )
	.option( '-c, --ci', 'Run in CI (non interactive)' )
	.option(
		'--rounds <count>',
		'Run each test suite this many times for each branch; results are summarized, default = 1'
	)
	.option( '--tests-branch <branch>', "Use this branch's performance test files" )
	.description( 'Runs performance tests on two separate branches and outputs the result' )
	.action( catchException( runPerformanceTests ) );

program.parse( process.argv );
