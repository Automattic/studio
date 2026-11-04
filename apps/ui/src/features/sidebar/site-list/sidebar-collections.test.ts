import { describe, expect, it } from 'vitest';
import {
	createSiteRows,
	getActiveSiteKeys,
	getListedSessions,
	getSidebarCollections,
	hasSeveralUnfoldedSites,
	mergeVisibleOrder,
	revealSite,
	toggleRevealedSite,
} from './sidebar-collections';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

const site = ( id: string ) =>
	( { id, name: `Site ${ id }`, path: `/sites/${ id }` } ) as SiteDetails;

const chat = (
	id: string,
	siteId: string,
	updatedAt: string,
	extra: Partial< AiSessionSummary > = {}
) =>
	( {
		id,
		ownerSiteId: siteId,
		updatedAt,
		firstPrompt: `Prompt ${ id }`,
		...extra,
	} ) as AiSessionSummary;

const sites = [ site( 'a' ), site( 'b' ) ];
const sessions = [
	chat( 'a1', 'a', '2026-01-01T00:00:00Z' ),
	chat( 'a2', 'a', '2026-01-03T00:00:00Z' ),
	chat( 'a3', 'a', '2026-01-04T00:00:00Z', { archived: true } ),
	chat( 'b1', 'b', '2026-01-02T00:00:00Z' ),
	chat( 'x1', 'gone', '2026-01-05T00:00:00Z' ),
];
const rows = createSiteRows( sites, sessions );
const defaults = { pins: [], chatOrder: {} };

describe( 'getListedSessions', () => {
	it( 'only lists conversations with a submitted message', () => {
		const blank = chat( 'new', 'a', '2026-01-06T00:00:00Z', { firstPrompt: undefined } );
		const named = { ...blank, id: 'named', title: 'Named draft' };
		const sent = { ...blank, id: 'sent', firstPrompt: 'Hello' };
		expect( getListedSessions( [ blank, named, sent ] ) ).toEqual( [ sent ] );
	} );
} );

describe( 'createSiteRows', () => {
	it( 'groups chats under their site, open ones most recent first', () => {
		expect( rows.map( ( row ) => row.sessionIds ) ).toEqual( [ [ 'a1', 'a2', 'a3' ], [ 'b1' ] ] );
		expect( rows[ 0 ].chats.map( ( session ) => session.id ) ).toEqual( [ 'a2', 'a1' ] );
	} );

	it( 'uses an explicit owner ID before legacy paths and never rebinds deleted owners', () => {
		const time = '2026-01-01T00:00:00Z';
		const legacyPath = { ownerSiteId: undefined, ownerSitePath: '/sites/a' };
		const explicit = chat( 'explicit', 'b', time, { ownerSitePath: '/sites/a' } );
		const legacy = chat( 'legacy', '', time, legacyPath );
		const removed = chat( 'removed', 'deleted', time, { ownerSitePath: '/sites/a' } );
		const orphan = chat( 'orphan', '', time, { ownerSiteId: undefined } );
		const result = createSiteRows(
			[ ...sites, { ...site( 'legacy' ), path: '/sites/a' } ],
			[ explicit, legacy, removed, orphan ]
		);
		expect( result.map( ( row ) => row.chats ) ).toEqual( [ [ legacy ], [ explicit ], [] ] );
	} );

	it( 'preserves stable ordering for tied or invalid dates and duplicate IDs', () => {
		const b = chat( 'b', 'b', '2026-01-01T00:00:00Z' );
		const a = chat( 'a', 'a', '2026-01-01T00:00:00Z' );
		const invalid = chat( 'invalid', 'a', 'invalid' );
		const duplicate = chat( 'a', 'b', '2026-01-02T00:00:00Z' );
		const input = [ b, a, invalid, duplicate ];
		const result = createSiteRows( sites, input );
		expect( result.map( ( row ) => row.chats ) ).toEqual( [
			[ a, invalid ],
			[ duplicate, b ],
		] );
		expect( input ).toEqual( [ b, a, invalid, duplicate ] );
	} );
} );

describe( 'getActiveSiteKeys', () => {
	it( 'finds the open chat’s site, or the site of a new chat', () => {
		expect(
			getActiveSiteKeys( rows, { activeSessionId: 'b1', pathname: '/sessions/b1' } )
		).toEqual( { chat: 'b', context: undefined } );
		expect( getActiveSiteKeys( rows, { activeSiteId: 'a', pathname: '/sites/a/new' } ).chat ).toBe(
			'a'
		);
	} );

	it( 'reports the site whose own page or settings are open', () => {
		expect( getActiveSiteKeys( rows, { activeSiteId: 'a', pathname: '/sites/a' } ) ).toEqual( {
			chat: undefined,
			context: 'a',
		} );
		expect(
			getActiveSiteKeys( rows, { activeSiteId: 'a', pathname: '/sites/a/settings' } ).context
		).toBe( 'a' );
	} );
} );

describe( 'getSidebarCollections', () => {
	it( 'lists each site’s chats in the saved order, and the latest under Recent', () => {
		const result = getSidebarCollections( rows, sessions, {
			...defaults,
			chatOrder: { a: [ 'a1', 'a2' ] },
		} );
		expect( result.chatsBySite.get( 'a' )?.map( ( { id } ) => id ) ).toEqual( [ 'a1', 'a2' ] );
		expect( result.recentChats.map( ( { id } ) => id ) ).toEqual( [ 'x1', 'a2', 'b1', 'a1' ] );
		expect( result.pinnedItems ).toEqual( [] );
		expect( result.siteRows ).toEqual( rows );
	} );

	it( 'moves pinned sites and chats into Pinned, naming a chat’s site', () => {
		const result = getSidebarCollections( rows, sessions, {
			...defaults,
			pins: [ 'chat:a1', 'site:b' ],
		} );
		expect(
			result.pinnedItems.map( ( item ) => [ item.key, item.siteName ?? item.row?.site.id ] )
		).toEqual( [
			[ 'site:b', 'b' ],
			[ 'chat:a1', 'Site a' ],
		] );
		expect( result.siteRows.map( ( row ) => row.site.id ) ).toEqual( [ 'a' ] );
		expect( result.chatsBySite.get( 'a' )?.map( ( { id } ) => id ) ).toEqual( [ 'a2' ] );
		expect( result.recentChats.map( ( { id } ) => id ) ).not.toContain( 'a1' );
	} );

	it( 'returns empty collections for missing sites or sessions', () => {
		expect( createSiteRows( [], sessions ) ).toEqual( [] );
		const empty = createSiteRows( sites, [] );
		const result = getSidebarCollections( empty, [], defaults );
		expect( empty[ 0 ].chats ).toEqual( [] );
		expect( result.chatsBySite.get( 'a' ) ).toEqual( [] );
		expect( result.pinnedItems ).toEqual( [] );
	} );
} );

describe( 'revealed sites', () => {
	it( 'folds the other sites on reveal unless auto-collapse is off', () => {
		expect( [ ...revealSite( new Set( [ 'a' ] ), 'b', true ) ] ).toEqual( [ 'b' ] );
		expect( [ ...revealSite( new Set( [ 'a' ] ), 'b', false ) ] ).toEqual( [ 'a', 'b' ] );
	} );

	it( 'folds only the active site when it is toggled again', () => {
		expect( [ ...toggleRevealedSite( new Set( [ 'a', 'b' ] ), 'a', 'a', false ) ] ).toEqual( [
			'b',
		] );
		expect( [ ...toggleRevealedSite( new Set( [ 'a' ] ), 'a', 'b', false ) ] ).toEqual( [ 'a' ] );
	} );

	it( 'offers Collapse all once two sites show chats', () => {
		const { siteRows, chatsBySite } = getSidebarCollections( rows, sessions, defaults );
		expect( hasSeveralUnfoldedSites( siteRows, chatsBySite, new Set( [ 'a' ] ) ) ).toBe( false );
		expect( hasSeveralUnfoldedSites( siteRows, chatsBySite, new Set( [ 'a', 'b' ] ) ) ).toBe(
			true
		);
	} );
} );

describe( 'mergeVisibleOrder', () => {
	it( 'reorders the visible chats and keeps the hidden ones in place', () => {
		expect( mergeVisibleOrder( [ 'a', 'b', 'c', 'd' ], [ 'b', 'a' ] ) ).toEqual( [
			'b',
			'a',
			'c',
			'd',
		] );
	} );
} );

describe( 'sidebar sorting', () => {
	it( 'groups pins by type without losing the mixed manual arrangement', () => {
		const pins = [ 'chat:a2', 'site:b', 'chat:a1', 'site:a' ];
		const options = { ...defaults, pins };
		expect(
			getSidebarCollections( rows, sessions, options ).pinnedItems.map( ( item ) => item.key )
		).toEqual( [ 'site:b', 'site:a', 'chat:a2', 'chat:a1' ] );
		expect(
			getSidebarCollections( rows, sessions, { ...options, pinnedSort: 'manual' } ).pinnedItems.map(
				( item ) => item.key
			)
		).toEqual( pins );
	} );

	it( 'puts running sites first, retaining their manual positions within each status', () => {
		const statusRows = createSiteRows(
			[
				{ ...site( 'a' ), running: false },
				{ ...site( 'b' ), running: true },
				{ ...site( 'c' ), running: false },
				{ ...site( 'd' ), running: true },
			],
			[]
		);
		expect(
			getSidebarCollections( statusRows, [], { ...defaults, siteSort: 'status' } ).siteRows.map(
				( row ) => row.site.id
			)
		).toEqual( [ 'b', 'd', 'a', 'c' ] );
		expect(
			getSidebarCollections( statusRows, [], defaults ).siteRows.map( ( row ) => row.site.id )
		).toEqual( [ 'a', 'b', 'c', 'd' ] );
	} );

	it( 'can return to newest chats without discarding saved order or changing Recent', () => {
		const options = { ...defaults, chatOrder: { a: [ 'a1', 'a2' ] } };
		const manual = getSidebarCollections( rows, sessions, options );
		const updated = getSidebarCollections( rows, sessions, { ...options, chatSort: 'updated' } );
		expect( manual.chatsBySite.get( 'a' )?.map( ( chat ) => chat.id ) ).toEqual( [ 'a1', 'a2' ] );
		expect( updated.chatsBySite.get( 'a' )?.map( ( chat ) => chat.id ) ).toEqual( [ 'a2', 'a1' ] );
		expect( updated.recentChats ).toEqual( manual.recentChats );
		expect( options.chatOrder.a ).toEqual( [ 'a1', 'a2' ] );
	} );

	it( 'keeps hidden pins in place when visible pins are dragged', () => {
		expect(
			mergeVisibleOrder(
				[ 'chat:a', 'chat:hidden', 'site:b', 'site:c' ],
				[ 'site:c', 'site:b', 'chat:a' ]
			)
		).toEqual( [ 'site:c', 'chat:hidden', 'site:b', 'chat:a' ] );
	} );
} );
