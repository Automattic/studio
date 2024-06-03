import startWPNow from './wp-now';
import { downloadWPCLI } from './download';
import { disableOutput } from './output';
import getWpCliPath from './get-wp-cli-path';
import getWpNowConfig from './config';
import { DEFAULT_PHP_VERSION, DEFAULT_WORDPRESS_VERSION } from './constants';
import { dirname } from 'path';
import fs from 'fs';

/**
 * This is an unstable API. Multiple wp-cli commands may not work due to a current limitation on php-wasm and pthreads.
 * @param args The arguments to pass to wp-cli.
 */
export async function executeWPCli(args: string[]) {
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

	const stdoutPath = '/tmp/stdout';
	const stderrPath = '/tmp/stderr';
	const phpScriptPath = '/tmp/run-cli.php';
	const vfsWpCliPath = '/wp-cli/wp-cli.phar';

  
	const phpScriptContent = `<?php
 	putenv('SHELL_PIPE=0');
  	$GLOBALS['argv'] = array_merge(["/tmp/wp-cli.phar", "--path=${wpNowOptions.documentRoot}"], ${JSON.stringify(args)});
 	define('STDIN', fopen('php://stdin', 'rb'));
  	define('STDOUT', fopen('${stdoutPath}', 'wb'));
  	define('STDERR', fopen('${stderrPath}', 'wb'));
  	require '${vfsWpCliPath}';
 	?>`;

	 fs.writeFileSync(phpScriptPath, phpScriptContent);
	 fs.writeFileSync(stdoutPath, '');
	 fs.writeFileSync(stderrPath, '');

	try {
		php.mount(dirname(getWpCliPath()), dirname(vfsWpCliPath));

		await php.cli([
			'php',
			phpScriptPath,
		  ]);
	  
		  const stdoutOutput = fs.readFileSync(stdoutPath, 'utf8');
		  const stderrOutput = fs.readFileSync(stderrPath, 'utf8');
	  
		  return { stdout: stdoutOutput, stderr: stderrOutput };
		} catch (resultOrError) {
		  const success = resultOrError.name === 'ExitStatus' && resultOrError.status === 0;
		  if (!success) {
			throw resultOrError;
		  }
		}
}
