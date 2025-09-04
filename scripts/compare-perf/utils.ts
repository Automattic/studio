/* eslint-disable no-console */
import childProcess from 'child_process';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';

/**
 * Utility to run a child script
 *
 * @param script Script to run.
 * @param cwd    Working directory.
 * @param env    Additional environment variables to pass to the script.
 */
export function runShellScript( script: string, cwd?: string, env: NodeJS.ProcessEnv = {} ) {
	return new Promise( ( resolve, reject ) => {
		childProcess.exec(
			script,
			{
				cwd,
				env: {
					NO_CHECKS: 'true',
					PATH: process.env.PATH,
					HOME: process.env.HOME,
					USER: process.env.USER,
					...env,
				},
			},
			function ( error, stdout, stderr ) {
				if ( error ) {
					console.log( chalk.red( `\nCommand failed: ${ script }` ) );
					console.log( chalk.red( `Working directory: ${ cwd || process.cwd() }` ) );
					console.log( chalk.red( `Exit code: ${ error.code }` ) );
					if ( stdout ) {
						console.log( chalk.yellow( '\nSTDOUT:' ) );
						console.log( stdout );
					}
					if ( stderr ) {
						console.log( chalk.red( '\nSTDERR:' ) );
						console.log( stderr );
					}
					reject( new Error( `Command failed: ${ script } (exit code: ${ error.code })` ) );
				} else {
					// Log successful commands for debugging
					console.log( chalk.gray( `✓ Command completed: ${ script }` ) );
					if ( stdout && stdout.trim() ) {
						console.log( chalk.gray( 'Output:' ) );
						console.log( stdout );
					}
					resolve( true );
				}
			}
		);
	} );
}

/**
 * Small utility used to read an uncached version of a JSON file
 *
 * @param fileName
 */
export function readJSONFile( fileName: string ) {
	const data = fs.readFileSync( fileName, 'utf8' );
	return JSON.parse( data );
}

/**
 * Asks the user for a confirmation to continue or abort otherwise.
 *
 * @param message      Confirmation message.
 * @param isDefault    Default reply.
 * @param abortMessage Abort message.
 */
export async function askForConfirmation(
	message: string,
	isDefault: boolean = true,
	abortMessage: string = 'Aborting.'
) {
	const { isReady } = await inquirer.prompt( [
		{
			type: 'confirm',
			name: 'isReady',
			default: isDefault,
			message,
		},
	] );

	if ( ! isReady ) {
		console.log( chalk.bold.red( '\n' + abortMessage ) );
		process.exit( 1 );
	}
}

/**
 * Scans the given directory and returns an array of file paths.
 *
 * @param dir The path to the directory to scan.
 *
 * @return An array of file paths.
 */
export function getFilesFromDir( dir: string ): string[] {
	if ( ! fs.existsSync( dir ) ) {
		console.log( 'Directory does not exist: ', dir );
		return [];
	}

	return fs
		.readdirSync( dir, { withFileTypes: true } )
		.filter( ( dirent ) => dirent.isFile() )
		.map( ( dirent ) => path.join( dir, dirent.name ) );
}
