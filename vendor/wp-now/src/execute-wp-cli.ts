import { downloadWpCli } from './download';
import getWpCliPath from './get-wp-cli-path';
import getWpNowConfig from './config';
import { DEFAULT_PHP_VERSION, DEFAULT_WORDPRESS_VERSION } from './constants';
import { phpVar } from '@php-wasm/util';
import { NodePHP } from '@php-wasm/node';

const isWindows = process.platform === 'win32';

/**
 * This is an unstable API. Multiple wp-cli commands may not work due to a current limitation on php-wasm and pthreads.
 */
export async function executeWPCli( projectPath: string, args: string[] ): Promise<{ stdout: string; stderr: string; exitCode: number; }> {
	await downloadWpCli();
	let options = await getWpNowConfig({
		php: DEFAULT_PHP_VERSION,
		wp: DEFAULT_WORDPRESS_VERSION,
		path: projectPath,
	});
	const php: NodePHP = await NodePHP.load(options.phpVersion,{
		requestHandler: {
			documentRoot: options.documentRoot,
			absoluteUrl: options.absoluteUrl,
		}
	});
	php.mount(projectPath, options.documentRoot);

	//Set the SAPI name to cli before running the script
	await php.setSapiName('cli');

	php.mkdir('/tmp');
	const stderrPath = '/tmp/stderr';
	const wpCliPath = '/tmp/wp-cli.phar';
	const runCliPath =  '/tmp/run-cli.php';
	php.writeFile(stderrPath, '');
	php.mount(getWpCliPath(), wpCliPath);

	php.writeFile(
		runCliPath,
		`<?php
		// Set up the environment to emulate a shell script
		// call.

		// Set SHELL_PIPE to 0 to ensure WP-CLI formats
		// the output as ASCII tables.
		// @see https://github.com/wp-cli/wp-cli/issues/1102
		putenv( 'SHELL_PIPE=0' );

		// When running PHP on Playground, the value of constant PHP_OS is set to Linux.
		// This implies that platform-specific logic won't work as expected. To solve this,
		// we use an environment variable to ensure WP-CLI runs the Windows-specific logic.
		putenv( 'WP_CLI_TEST_IS_WINDOWS=${isWindows ? 1 : 0}' );

		// Set the argv global.
		$GLOBALS['argv'] = array_merge([
		  "${wpCliPath}",
		  "--path=${php.documentRoot}"
		], ${phpVar(args)});

		// Provide stdin, stdout, stderr streams outside of
		// the CLI SAPI.
		define('STDIN', fopen('php://stdin', 'rb'));
		define('STDOUT', fopen('php://stdout', 'wb'));
		define('STDERR', fopen('${stderrPath}', 'wb'));

		// WP-CLI uses this argument for checking updates. Seems it's not defined by Playground
		// when running a script, so we explicitly set it.
		// Reference: https://github.com/wp-cli/wp-cli/blob/main/php/WP_CLI/Runner.php#L1889
		$_SERVER['argv'][0] = '${wpCliPath}';

		require( '${wpCliPath}' );`
	);

	// Set site's folder as the current working directory as the terminal will opened in that location.
	php.chdir(options.documentRoot);

	try {
		const result = await php.run({
			scriptPath: runCliPath,
		});

		const stderr = php.readFileAsText(stderrPath).replace('PHP.run() output was: #!/usr/bin/env php', '').trim();

		return { stdout: result.text.replace('#!/usr/bin/env php', '').trim(), stderr, exitCode: result.exitCode };
	} catch (error) {
		const stderr = php.readFileAsText(stderrPath).replace('PHP.run() output was: #!/usr/bin/env php', '').trim();
		return { stdout: '', stderr, exitCode: 1 };
	}
}
