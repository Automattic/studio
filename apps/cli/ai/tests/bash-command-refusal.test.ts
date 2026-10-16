import { describe, expect, it } from 'vitest';
import { getBashCommandRefusal } from 'cli/ai/runtimes/pi/tool-safety';

const refusal = ( command: string ) => getBashCommandRefusal( { command } );

describe( 'getBashCommandRefusal', () => {
	it.each( [
		'wp option get siteurl',
		'cd ~/Studio/site && wp plugin list',
		'FOO=1 wp post list',
		'/usr/local/bin/wp core version',
		'echo $(wp option get home)',
		'php wp-cli.phar plugin list | wp-cli.phar --info',
	] )( 'routes WP-CLI to wp_cli: %s', ( command ) => {
		expect( refusal( command ) ).toContain( 'wp_cli' );
	} );

	it.each( [ 'studio site start --path ~/Studio/a', 'npx studio site create' ] )(
		'routes the Studio CLI to the site tools: %s',
		( command ) => {
			expect( refusal( command ) ).toContain( 'site_start' );
		}
	);

	it.each( [
		'ls wp-content/themes',
		'grep -rn "wp option" wp-includes',
		"echo 'run wp later; studio site'",
		'cat wp-config.php',
		'npm run build',
		'find . -name "*.php" | xargs grep -l studio',
	] )( 'runs other commands: %s', ( command ) => {
		expect( refusal( command ) ).toBeUndefined();
	} );
} );
