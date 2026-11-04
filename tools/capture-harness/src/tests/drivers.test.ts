import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { studioAssistantQuotaSchema } from '../../../../packages/common/lib/studio-assistant-quota.ts';
import { blockedOperation, parseQuota } from '../drivers/browser.ts';
import { SCENES_DIR } from '../paths.ts';
import { doctor, ready } from '../setup.ts';

describe( 'browser driver', () => {
	it( 'refuses the API calls that would change the signed-in account', () => {
		expect( blockedOperation( 'POST', '/auth/logout' ) ).toBeDefined();
		expect( blockedOperation( 'POST', '/sites/abc/push' ) ).toBeDefined();
		expect( blockedOperation( 'POST', '/sites/abc/pull' ) ).toBeDefined();
		expect( blockedOperation( 'POST', '/sites/abc/preview' ) ).toBeDefined();
		expect( blockedOperation( 'DELETE', '/snapshots/x.wp.build' ) ).toBeDefined();
		expect( blockedOperation( 'PATCH', '/snapshots/x.wp.build' ) ).toBeDefined();
		expect( blockedOperation( 'POST', '/sites/abc/connected-sites' ) ).toBeDefined();
		expect( blockedOperation( 'DELETE', '/sites/abc/connected-sites/123' ) ).toBeDefined();
		expect( blockedOperation( 'POST', '/sessions/s1/messages' ) ).toBeDefined();
	} );

	it( 'lets reads and local changes through', () => {
		expect( blockedOperation( 'GET', '/snapshots' ) ).toBeUndefined();
		expect( blockedOperation( 'GET', '/sites/abc/connected-sites' ) ).toBeUndefined();
		expect( blockedOperation( 'POST', '/sites' ) ).toBeUndefined();
		expect( blockedOperation( 'POST', '/sessions' ) ).toBeUndefined();
	} );

	it( "answers /api/quota in the shape the server's own parse gives", async () => {
		const raw = JSON.parse(
			await readFile( path.join( SCENES_DIR, 'wren-and-barley/ai-quota.json' ), 'utf8' )
		);
		expect( JSON.parse( JSON.stringify( parseQuota( raw ) ) ) ).toEqual(
			JSON.parse( JSON.stringify( studioAssistantQuotaSchema.parse( raw ) ) )
		);
	} );
} );

describe( 'doctor', () => {
	it( 'names a fix for everything it finds missing', () => {
		const checks = doctor( { STUDIO_CLI: '/nowhere/main.mjs', STUDIO_APP: '/nowhere/Studio' } );
		for ( const check of checks.filter( ( c ) => c.status !== 'ok' ) ) {
			expect( check.fix, check.name ).toBeTruthy();
		}
		expect( checks.find( ( c ) => c.name === 'Studio Desktop' )?.status ).toBe( 'missing' );
	} );

	it( 'judges readiness only on what the chosen front end needs', () => {
		const checks = [
			{ name: 'a', status: 'ok' as const, detail: '' },
			{ name: 'b', status: 'missing' as const, detail: '', for: 'electron' as const },
			{ name: 'c', status: 'optional' as const, detail: '' },
		];
		expect( ready( checks, [ 'browser' ] ) ).toBe( true );
		expect( ready( checks, [ 'electron', 'browser' ] ) ).toBe( false );
	} );
} );
