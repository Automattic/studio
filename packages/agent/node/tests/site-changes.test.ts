import { describe, expect, it } from 'vitest';
import { SiteChanges, type SiteChangeSource } from '@studio/agent/node/site-changes';
import { createFakeHost } from '@studio/agent/node/tests/fake-host';
import type { HostSite } from '@studio/agent/node/host';

const sites = [
	{ path: '/a', name: 'A' },
	{ path: '/b', name: 'B' },
] as HostSite[];

// A source whose every read is a change, which logs when its check starts and
// ends, and ends after `ms`.
function source( name: string, ms: number, log: string[], saves?: boolean ): SiteChangeSource {
	let reads = 0;
	return {
		name,
		saves,
		async read() {
			return { version: String( reads++ ) };
		},
		async check( site ) {
			log.push( `start ${ name } ${ site.path }` );
			await new Promise( ( resolve ) => setTimeout( resolve, ms ) );
			log.push( `end ${ name } ${ site.path }` );
			return { reports: [ { key: name, summary: `${ name } ${ site.path }` } ] };
		},
	};
}

async function settle( sources: ( log: string[] ) => SiteChangeSource[] ) {
	const log: string[] = [];
	const changes = new SiteChanges( createFakeHost(), undefined, async () => sites, sources( log ) );
	await changes.snapshot();
	const { summaries } = await changes.settle();
	return { log, summaries };
}

describe( 'SiteChanges.settle', () => {
	it( 'runs the checks that save one at a time, in order, before the others', async () => {
		const { log } = await settle( ( log ) => [
			source( 'reader', 1, log ),
			source( 'first saver', 20, log, true ),
			source( 'second saver', 1, log, true ),
		] );

		const forA = log.filter( ( line ) => line.endsWith( ' /a' ) );
		expect( forA ).toEqual( [
			'start first saver /a',
			'end first saver /a',
			'start second saver /a',
			'end second saver /a',
			'start reader /a',
			'end reader /a',
		] );
	} );

	it( 'runs the checks that do not save, and the sites, together', async () => {
		const { log } = await settle( ( log ) => [
			source( 'slow', 30, log ),
			source( 'fast', 1, log ),
		] );

		// Every check started before the slow ones ended.
		expect( log.slice( 0, 4 ).every( ( line ) => line.startsWith( 'start ' ) ) ).toBe( true );
	} );

	it( 'reports by site and source, in their order, whichever check ends first', async () => {
		const { summaries } = await settle( ( log ) => [
			source( 'slow', 30, log ),
			source( 'saver', 1, log, true ),
			source( 'fast', 1, log ),
		] );

		expect( summaries ).toEqual( [
			'slow /a',
			'saver /a',
			'fast /a',
			'slow /b',
			'saver /b',
			'fast /b',
		] );
	} );

	it( 'reads the sites once for calls the model makes at once', async () => {
		const reads: string[] = [];
		const counted: SiteChangeSource = {
			name: 'counted',
			async read( sitePath ) {
				reads.push( sitePath );
				await new Promise( ( resolve ) => setTimeout( resolve, 5 ) );
				return {};
			},
			async check() {
				return { reports: [] };
			},
		};
		const changes = new SiteChanges( createFakeHost(), undefined, async () => sites, [ counted ] );
		await Promise.all( [ changes.snapshot(), changes.snapshot(), changes.snapshot() ] );
		expect( reads ).toEqual( [ '/a', '/b' ] );
		await changes.snapshot();
		expect( reads ).toHaveLength( 4 );
	} );
} );
