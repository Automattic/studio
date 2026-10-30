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

describe( 'SiteChanges.begin', () => {
	type Step = ( changes: SiteChanges ) => void;
	const none: Step = () => undefined;
	// What happens as a call's checks end, and after, until the next call begins and reads `reads` times.
	it.each< [ string, Step, Step, number ] >( [
		[ 'reads nothing the snapshot taken as the last checks ended holds', none, none, 0 ],
		[ 'reads again after Studio changed a site since', none, ( changes ) => changes.stale(), 2 ],
		[
			'reads again when a call was running as the checks ended',
			( changes ) => void changes.begin(),
			none,
			2,
		],
	] )( '%s', async ( _name, asChecksEnd, after, reads ) => {
		let read = 0;
		const counted: SiteChangeSource = {
			name: 'counted',
			async read() {
				read++;
				return {};
			},
			async check() {
				return { reports: [] };
			},
		};
		const changes = new SiteChanges( createFakeHost(), undefined, async () => sites, [ counted ] );
		await changes.begin();
		changes.end();
		await changes.settle();
		asChecksEnd( changes );
		changes.afterChecks();
		await new Promise( ( resolve ) => setTimeout( resolve, 5 ) );
		after( changes );
		read = 0;
		await changes.begin();
		expect( read ).toBe( reads );
	} );
} );

describe( 'SiteChanges.takeSourceMs', () => {
	it( 'gives the longest read and check of each source since the last take', async () => {
		const changes = new SiteChanges( createFakeHost(), undefined, async () => sites, [
			source( 'slow', 30, [] ),
		] );
		await changes.snapshot();
		await changes.settle();
		const taken = changes.takeSourceMs();
		expect( Object.keys( taken ) ).toEqual( [ 'read slow', 'check slow' ] );
		expect( taken[ 'check slow' ] ).toBeGreaterThanOrEqual( 25 );
		expect( changes.takeSourceMs() ).toEqual( {} );
	} );
} );
