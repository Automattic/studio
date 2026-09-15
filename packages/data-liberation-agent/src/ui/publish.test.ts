import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { publishSite, resolvePublishDirectory } from './publish.js';
import { registerPublishTarget, unregisterPublishTarget } from '../lib/publish/index.js';

const dirs: string[] = [];
afterEach( () => {
	for ( const dir of dirs.splice( 0 ) ) rmSync( dir, { recursive: true, force: true } );
} );

function liberatedRun(): string {
	const dir = mkdtempSync( join( tmpdir(), 'dla-publish-ui-' ) );
	dirs.push( dir );
	mkdirSync( join( dir, 'website' ), { recursive: true } );
	writeFileSync( join( dir, 'website', 'index.html' ), '<h1>Home</h1>' );
	writeFileSync( join( dir, 'capture-receipt.json' ), '{}' );
	return dir;
}

describe( 'resolvePublishDirectory', () => {
	it( 'publishes website/ when handed the liberated run directory', () => {
		const run = liberatedRun();
		expect( resolvePublishDirectory( run ) ).toBe( join( run, 'website' ) );
	} );

	it( 'publishes a plain directory as-is', () => {
		const run = liberatedRun();
		expect( resolvePublishDirectory( join( run, 'website' ) ) ).toBe( join( run, 'website' ) );
	} );

	it( 'rejects a path that is not a directory', () => {
		const run = liberatedRun();
		expect( () => resolvePublishDirectory( join( run, 'capture-receipt.json' ) ) ).toThrow(
			'Not a directory'
		);
	} );
} );

describe( 'publishSite', () => {
	it('cleans staging when the attribution hook fails', async () => {
		const run = liberatedRun();
		let staging = '';
		registerPublishTarget({ name: 'failed-attribution',
			async attribution({ directory }) { staging = directory; throw new Error('attribution failed'); },
			async publish() { throw new Error('publisher must not execute'); },
		});
		try {
			await expect(publishSite({ directory: run, target: 'failed-attribution' })).rejects.toThrow('attribution failed');
			expect(existsSync(staging)).toBe(false);
			expect(readFileSync(join(run, 'website', 'index.html'), 'utf8')).toBe('<h1>Home</h1>');
		} finally { unregisterPublishTarget('failed-attribution'); }
	});
	it.each([false, true])('stages destination attribution and preserves the artifact, publisher fails=%s', async (fail) => {
		const run = liberatedRun();
		let staging = '';
		registerPublishTarget({ name: 'attribution-test',
			async attribution({ directory }) {
				staging = directory;
				writeFileSync(join(directory, 'index.html'), readFileSync(join(directory, 'index.html'), 'utf8') + '<footer>Published by Target</footer>');
			},
			async publish({ directory }) {
				expect(readFileSync(join(directory, 'index.html'), 'utf8')).toContain('Published by Target');
				if (fail) throw new Error('publisher failed');
				return { target: 'attribution-test', liveUrl: 'https://example.test/', files: 1, bytes: 60, notes: [] };
			},
		});
		try {
			const result = publishSite({ directory: run, target: 'attribution-test' });
			if (fail) await expect(result).rejects.toThrow('publisher failed'); else await expect(result).resolves.toMatchObject({ files: 1 });
			expect(readFileSync(join(run, 'website', 'index.html'), 'utf8')).toBe('<h1>Home</h1>');
			expect(existsSync(staging)).toBe(false);
		} finally { unregisterPublishTarget('attribution-test'); }
	});
	it('publishes without adding attribution by default', async () => {
		const run = liberatedRun();
		registerPublishTarget({ name: 'plain-test', async publish({ directory }) {
			expect(readFileSync(join(directory, 'index.html'), 'utf8')).toBe('<h1>Home</h1>');
			return { target: 'plain-test', liveUrl: 'https://example.test/', files: 1, bytes: 13, notes: [] };
		} });
		try { await publishSite({ directory: run, target: 'plain-test' }); }
		finally { unregisterPublishTarget('plain-test'); }
	});
	it( 'rejects an unknown target and names the ones that exist', async () => {
		await expect(
			publishSite( { directory: liberatedRun(), target: 'nowhere' } )
		).rejects.toThrow( /Unknown publish target "nowhere"\. Available: spacefast\./ );
	} );
} );
