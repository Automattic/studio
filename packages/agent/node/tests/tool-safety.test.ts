import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	getPayloadLimitViolation,
	getSettingsAccessRefusal,
	STUDIO_FILE_TOOL_MAX_BYTES,
} from '@studio/agent/node/tool-safety';

const big = 'x'.repeat( STUDIO_FILE_TOOL_MAX_BYTES + 1 );
const half = 'x'.repeat( Math.ceil( STUDIO_FILE_TOOL_MAX_BYTES / 2 ) );

describe( 'getPayloadLimitViolation', () => {
	it( 'rejects a Write whose content exceeds the limit', () => {
		expect( getPayloadLimitViolation( 'Write', { path: 'a.css', content: big } ) ).toContain(
			'Write content'
		);
		expect( getPayloadLimitViolation( 'Write', { path: 'a.css', content: half } ) ).toBeUndefined();
	} );

	it( 'counts bytes, not characters', () => {
		const accented = 'é'.repeat( Math.ceil( STUDIO_FILE_TOOL_MAX_BYTES / 2 ) + 1 );
		expect( getPayloadLimitViolation( 'Write', { path: 'a.css', content: accented } ) ).toContain(
			'Write content'
		);
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

describe( 'getSettingsAccessRefusal', () => {
	const home = path.resolve( '/home/user' );
	const settings = path.join( home, '.studio' );
	const resolvePath = ( file: string ) => path.resolve( home, 'Studio', file );

	beforeEach( () => vi.stubEnv( 'DEV_CONFIG_DIR', settings ) );
	afterEach( () => vi.unstubAllEnvs() );

	it( 'refuses file tools on the settings', () => {
		for ( const tool of [ 'Read', 'Write', 'Edit', 'Grep' ] ) {
			expect(
				getSettingsAccessRefusal(
					tool,
					{ path: path.join( settings, 'config.json' ) },
					resolvePath
				)
			).toContain( 'Not run' );
		}
		expect( getSettingsAccessRefusal( 'Read', { path: '../.studio' }, resolvePath ) ).toContain(
			'Not run'
		);
		expect(
			getSettingsAccessRefusal(
				'Read',
				{ path: path.join( settings, 'skills', '..', 'shared.json' ) },
				resolvePath
			)
		).toContain( 'Not run' );
	} );

	it( 'allows the folders the agent works in', () => {
		for ( const folder of [ 'tmp/ai-payloads/home.html', 'skills/a/SKILL.md', 'knowledge' ] ) {
			expect(
				getSettingsAccessRefusal( 'Write', { path: path.join( settings, folder ) }, resolvePath )
			).toBeUndefined();
		}
		expect(
			getSettingsAccessRefusal( 'Read', { path: 'my-site/wp-config.php' }, resolvePath )
		).toBeUndefined();
	} );

	it( 'follows links into the settings', () => {
		const root = mkdtempSync( path.join( os.tmpdir(), 'studio-settings-' ) );
		const linked = path.join( root, '.studio' );
		const site = path.join( root, 'site' );
		mkdirSync( linked );
		mkdirSync( site );
		writeFileSync( path.join( linked, 'config.json' ), '{}' );
		// A junction on Windows, which needs no admin rights; a symlink elsewhere.
		symlinkSync( linked, path.join( site, 'notes' ), 'junction' );
		vi.stubEnv( 'DEV_CONFIG_DIR', linked );
		const inSite = ( file: string ) => path.resolve( site, file );
		try {
			expect( getSettingsAccessRefusal( 'Read', { path: 'notes/config.json' }, inSite ) ).toContain(
				'Not run'
			);
			expect( getSettingsAccessRefusal( 'Write', { path: 'notes/new.json' }, inSite ) ).toContain(
				'Not run'
			);
			expect(
				getSettingsAccessRefusal( 'Write', { path: 'notes/tmp/payload.json' }, inSite )
			).toBeUndefined();
		} finally {
			rmSync( root, { recursive: true, force: true } );
		}
	} );

	it( 'refuses a Grep over a folder that holds the settings', () => {
		expect( getSettingsAccessRefusal( 'Grep', { path: home }, resolvePath ) ).toContain(
			'Not run'
		);
		expect( getSettingsAccessRefusal( 'Ls', { path: home }, resolvePath ) ).toBeUndefined();
	} );

	it( 'refuses Bash commands that name the settings', () => {
		for ( const command of [
			'cat ~/.studio/config.json',
			'cd $HOME/.studio && cat config.json',
			'grep -r token "/Users/me/.studio"',
			'cd ~ && cat .studio/shared.json',
			'cat ~/.studio/skills/../config.json',
		] ) {
			expect( getSettingsAccessRefusal( 'Bash', { command }, resolvePath ) ).toContain( 'Not run' );
		}
	} );

	it( 'runs Bash commands that only touch the agent folders or sites', () => {
		for ( const command of [
			'ls ~/.studio/tmp/ai-payloads',
			'cat ~/.studio/skills/a/SKILL.md',
			'curl -s https://example.studio/page',
			'ls ~/Studio/my-site',
		] ) {
			expect( getSettingsAccessRefusal( 'Bash', { command }, resolvePath ) ).toBeUndefined();
		}
	} );
} );
