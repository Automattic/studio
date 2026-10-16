import { describe, expect, it } from 'vitest';
import {
	getBashCommandRefusal,
	getPayloadLimitViolation,
	STUDIO_FILE_TOOL_MAX_BYTES,
} from '../tool-safety';

const big = 'x'.repeat( STUDIO_FILE_TOOL_MAX_BYTES + 1 );
const half = 'x'.repeat( Math.ceil( STUDIO_FILE_TOOL_MAX_BYTES / 2 ) );

describe( 'getPayloadLimitViolation', () => {
	it( 'rejects a Write whose content exceeds the limit', () => {
		expect( getPayloadLimitViolation( 'Write', { path: 'a.css', content: big } ) ).toContain(
			'Write content'
		);
		expect( getPayloadLimitViolation( 'Write', { path: 'a.css', content: half } ) ).toBeUndefined();
	} );

	it( 'sums every entry of an Edit call', () => {
		const oneBig = { path: 'a.css', edits: [ { oldText: '/* a */', newText: big } ] };
		expect( getPayloadLimitViolation( 'Edit', oneBig ) ).toContain( 'Edit edits' );

		const twoHalves = {
			path: 'a.css',
			edits: [
				{ oldText: '/* a */', newText: half },
				{ oldText: '/* b */', newText: half },
			],
		};
		expect( getPayloadLimitViolation( 'Edit', twoHalves ) ).toContain( 'Edit edits' );

		const small = {
			path: 'a.css',
			edits: [ { oldText: '/* a */', newText: 'a { color: red; }' } ],
		};
		expect( getPayloadLimitViolation( 'Edit', small ) ).toBeUndefined();
	} );

	it( 'reads an Edit whose edits arrived as a JSON string', () => {
		const params = {
			path: 'a.css',
			edits: JSON.stringify( [ { oldText: '/* a */', newText: big } ] ),
		};
		expect( getPayloadLimitViolation( 'Edit', params ) ).toContain( 'Edit edits' );
	} );

	it( 'ignores Edit calls without a usable edits array', () => {
		expect( getPayloadLimitViolation( 'Edit', { path: 'a.css' } ) ).toBeUndefined();
		expect( getPayloadLimitViolation( 'Edit', { path: 'a.css', edits: '{' } ) ).toBeUndefined();
	} );
} );

describe( 'getBashCommandRefusal', () => {
	it( 'refuses WP-CLI in command position and names wp_cli', () => {
		for ( const command of [
			'wp option get home',
			'cd ~/Studio/site && wp post list',
			'FOO=1 sudo wp plugin list',
			'studio wp option get home',
			'echo $(wp option get home)',
			'/usr/local/bin/wp --info',
		] ) {
			expect( getBashCommandRefusal( 'Bash', { command } ) ).toContain( 'wp_cli' );
		}
	} );

	it( 'leaves paths and words that only contain wp alone', () => {
		for ( const command of [
			'ls wp-content/themes',
			'grep -rn wp_enqueue_script wp-includes',
			'cat ~/Studio/site/wp-config.php',
			'echo wp',
		] ) {
			expect( getBashCommandRefusal( 'Bash', { command } ) ).toBeUndefined();
		}
		expect( getBashCommandRefusal( 'Read', { command: 'wp' } ) ).toBeUndefined();
	} );
} );
