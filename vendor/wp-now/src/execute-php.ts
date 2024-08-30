import startWPNow from './wp-now';
import { WPNowOptions } from './config';
import { disableOutput } from './output';
import * as path from 'path';
import fs from 'fs-extra';

/**
 * Execute a PHP cli given its parameters.
 *
 * @param phpArgs - Arguments to pass to the PHP cli. The first argument should be the string 'php'.
 * @param options - Optional configuration object for WPNow. Defaults to an empty object.
 * @returns - Returns a Promise that resolves to an object containing
 * the exit name and status (0 for success).
 * @throws - Throws an error if the first element in phpArgs is not the string 'php'.
 */
export async function executePHP(
	phpArgs: string[],
	options: WPNowOptions = {}
) {
	if (phpArgs[0] !== 'php') {
		throw new Error(
			'The first argument to executePHP must be the string "php".'
		);
	}
	disableOutput();
	const { phpInstances, options: wpNowOptions } = await startWPNow({
		...options,
		numberOfPhpInstances: 2,
	});
	const [, php] = phpInstances;

	try {
		if (!path.isAbsolute(phpArgs[1])) {
			const maybePhpFile = path.join(
				wpNowOptions.projectPath,
				phpArgs[1]
			);
			if (fs.existsSync(maybePhpFile)) {
				phpArgs[1] = maybePhpFile;
			}
		}
		await php.cli(phpArgs);
	} catch (resultOrError) {
		const success =
			resultOrError.name === 'ExitStatus' && resultOrError.status === 0;
		if (!success) {
			throw resultOrError;
		}
	}
}
