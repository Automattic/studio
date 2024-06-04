import startWPNow from './wp-now';
import { downloadWPCLI } from './download';
import { disableOutput } from './output';
import getWpCliPath from './get-wp-cli-path';
import getWpNowConfig from './config';
import { DEFAULT_PHP_VERSION, DEFAULT_WORDPRESS_VERSION } from './constants';
import { dirname, join } from 'path';
import fs from 'fs';

/**
 * This is an unstable API. Multiple wp-cli commands may not work due to a current limitation on php-wasm and pthreads.
 * @param args The arguments to pass to wp-cli.
 */
export async function executeWPCli(args: string[]): Promise<{ stdout: string; stderr: string; }> {
	await downloadWPCLI();
	disableOutput();
	const options = await getWpNowConfig({
		php: DEFAULT_PHP_VERSION,
		wp: DEFAULT_WORDPRESS_VERSION,
		path: process.env.WP_NOW_PROJECT_PATH || process.cwd(),
	});
	const { phpInstances, options: wpNowOptions } = await startWPNow({
		...options,
		numberOfPhpInstances: 2,
	});
	const [, php] = phpInstances;

	// Define a specific directory within the current working directory
	const tmpDir = join(process.cwd(), 'wp-cli-temp');
	if (!fs.existsSync(tmpDir)) {
		fs.mkdirSync(tmpDir, { recursive: true });
	}

	const stdoutPath = join(tmpDir, 'stdout');
	const stderrPath = join(tmpDir, 'stderr');
	const phpScriptPath = join(tmpDir, 'run-cli.php');
	const vfsWpCliPath = '/wp-cli/wp-cli.phar';

	const phpScriptContent = `<?php
		putenv('SHELL_PIPE=0');
		\$argv = array_merge(["/wp-cli/wp-cli.phar", "--path=${wpNowOptions.documentRoot}"], ${JSON.stringify(args)});
		define('STDIN', fopen('php://stdin', 'rb'));
		define('STDOUT', fopen('${stdoutPath}', 'wb'));
		define('STDERR', fopen('${stderrPath}', 'wb'));
		if (!file_exists('/wp-cli/wp-cli.phar')) {
			fwrite(STDERR, "Could not find wp-cli.phar at /wp-cli/wp-cli.phar\n");
			exit(1);
		}
		require '/wp-cli/wp-cli.phar';
	?>`;

	console.log(`Writing PHP script to ${phpScriptPath}`);
	fs.writeFileSync(phpScriptPath, phpScriptContent);

	console.log(`Creating stdout and stderr files`);
	fs.writeFileSync(stdoutPath, '');
	fs.writeFileSync(stderrPath, '');

	try {
		console.log(`Mounting wp-cli path ${dirname(getWpCliPath())} to /wp-cli`);
		php.mount(dirname(getWpCliPath()), '/wp-cli');

		console.log(`Mounting temporary directory ${tmpDir} to /tmp`);
		php.mount(tmpDir, '/tmp');

		console.log(`Checking if PHP script file exists at ${phpScriptPath}`);
		if (!fs.existsSync(phpScriptPath)) {
			throw new Error(`PHP script file does not exist at ${phpScriptPath}`);
		}

		console.log(`Executing PHP script at ${phpScriptPath}`);
		await php.cli([
			'php',
			'/tmp/run-cli.php',
		]);

		const stdoutOutput = fs.readFileSync(stdoutPath, 'utf8');
		const stderrOutput = fs.readFileSync(stderrPath, 'utf8');

		return { stdout: stdoutOutput, stderr: stderrOutput };
	} catch (resultOrError) {
		console.error('Error during PHP execution:', resultOrError);
		const success = resultOrError.name === 'ExitStatus' && resultOrError.status === 0;
		if (!success) {
			return { stdout: '', stderr: resultOrError.message || 'An unknown error occurred' };
		}
		return { stdout: '', stderr: '' };
	}
}
