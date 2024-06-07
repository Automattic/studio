import startWPNow from './wp-now';
import { downloadWpCli } from './download';
import getWpCliPath from './get-wp-cli-path';
import getWpNowConfig from './config';
import { DEFAULT_PHP_VERSION, DEFAULT_WORDPRESS_VERSION } from './constants';
import { phpVar } from '@php-wasm/util';

/**
 * This is an unstable API. Multiple wp-cli commands may not work due to a current limitation on php-wasm and pthreads.
 */
export async function executeWPCli ( projectPath: string, args: string[] ): Promise<{ stdout: string; stderr: string; }> {
	await downloadWpCli();
	const options = await getWpNowConfig({
		php: DEFAULT_PHP_VERSION,
		wp: DEFAULT_WORDPRESS_VERSION,
		path: projectPath,
	});
	const { phpInstances, options: wpNowOptions } = await startWPNow({
		...options,
		numberOfPhpInstances: 2,
	});
	const [, php] = phpInstances;

	//Set the SAPI name to cli before running the script
	await php.setSapiName('cli');

	php.mkdir('/tmp');
	const stderrPath = '/tmp/stderr';
	const wpCliPath = '/tmp/wp-cli.phar';
	const runCliPath =  '/tmp/run-cli.php';
	await php.writeFile(stderrPath, '');
	php.mount(getWpCliPath(), wpCliPath);

	await php.writeFile(
		runCliPath,
		`<?php
		// Set up the environment to emulate a shell script
		// call.

		// Set SHELL_PIPE to 0 to ensure WP-CLI formats
		// the output as ASCII tables.
		// @see https://github.com/wp-cli/wp-cli/issues/1102
		putenv( 'SHELL_PIPE=0' );

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

		require( '${wpCliPath}' );`
	);


	try {
		const result = await php.run({
			scriptPath: runCliPath,
		});

		return { stdout: result.text.replace('#!/usr/bin/env php', '').trim(), stderr: result.errors };
	} catch (error) {
		const errorContent = php.readFileAsText(stderrPath);
		return { stdout: '', stderr: errorContent };
	}
}
