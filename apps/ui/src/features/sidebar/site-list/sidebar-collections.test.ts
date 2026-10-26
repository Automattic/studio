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
const defaults = { pins: [], chatOrder: {}, needingInput: [] };

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
			[ 'chat:a1', 'Site a' ],
			[ 'site:b', 'b' ],
		] );
		expect( result.siteRows.map( ( row ) => row.site.id ) ).toEqual( [ 'a' ] );
		expect( result.chatsBySite.get( 'a' )?.map( ( { id } ) => id ) ).toEqual( [ 'a2' ] );
		expect( result.recentChats.map( ( { id } ) => id ) ).not.toContain( 'a1' );
	} );

	it( 'shows a chat waiting on an answer only under Needs input', () => {
		const result = getSidebarCollections( rows, sessions, {
			...defaults,
			pins: [ 'chat:a2' ],
			needingInput: [ 'a2' ],
		} );
		expect( result.needsInputChats.map( ( { id } ) => id ) ).toEqual( [ 'a2' ] );
		expect( result.pinnedItems ).toEqual( [] );
		expect( result.chatsBySite.get( 'a' )?.map( ( { id } ) => id ) ).toEqual( [ 'a1' ] );
		expect( result.recentChats.map( ( { id } ) => id ) ).not.toContain( 'a2' );
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
