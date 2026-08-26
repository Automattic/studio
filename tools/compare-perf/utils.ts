/* eslint-disable no-console */
import childProcess from 'child_process';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';

/**
 * Utility to run a child script.
 *
 * The script string is passed as an argument to the shell rather than being
 * interpolated into the command itself, which prevents shell metacharacters
 * in environment-derived values (e.g. paths with spaces) from altering the
 * meaning of the command.
 *
 * @param script Shell command to run.
 * @param cwd    Working directory.
 * @param env    Additional environment variables to pass to the script.
 */
export function runShellScript( script: string, cwd?: string, env: NodeJS.ProcessEnv = {} ) {
	return new Promise( ( resolve, reject ) => {
		childProcess.execFile(
			process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
			process.platform === 'win32' ? [ '/c', script ] : [ '-c', script ],
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
					console.log( stdout ); // Sometimes the error message is thrown via stdout.
					console.log( stderr );
					reject( error );
				} else {
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
