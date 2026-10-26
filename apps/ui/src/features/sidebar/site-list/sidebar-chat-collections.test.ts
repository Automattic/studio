import { describe, expect, it } from 'vitest';
import { chatPinKey } from '@/data/queries/use-sidebar-pins';
import { createSiteRows, getSidebarCollections } from './sidebar-collections';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

const sites = [
	{ id: 'a', path: '/a', name: 'A' },
	{ id: 'b', path: '/b', name: 'B' },
	{ id: 'legacy', path: '/a', name: 'Legacy' },
] as SiteDetails[];

function chat(
	id: string,
	owner: Partial< AiSessionSummary > = {},
	updatedAt = '2026-10-12T10:00:00Z'
): AiSessionSummary {
	return { id, updatedAt, ...owner } as AiSessionSummary;
}

function collect( siteList: SiteDetails[], sessions: AiSessionSummary[], pinnedIds: string[] ) {
	const rows = createSiteRows( siteList, sessions );
	return {
		rows,
		...getSidebarCollections( rows, sessions, {
			pins: pinnedIds.map( chatPinKey ),
			chatOrder: {},
			needingInput: [],
			chatEnabled: true,
		} ),
	};
}

const chatsOf = ( rows: ReturnType< typeof createSiteRows >, siteId: string ) =>
	rows.find( ( row ) => row.site.id === siteId )?.chats;

describe( 'sidebar chat collections', () => {
	it( 'uses an explicit owner ID before legacy paths and never rebinds deleted owners', () => {
		const explicit = chat( 'explicit', { ownerSiteId: 'b', ownerSitePath: '/a' } );
		const legacy = chat( 'legacy', { ownerSitePath: '/a' } );
		const removed = chat( 'removed', { ownerSiteId: 'deleted', ownerSitePath: '/a' } );
		const { rows } = collect( sites, [ explicit, legacy, removed, chat( 'orphan' ) ], [] );
		expect( chatsOf( rows, 'a' ) ).toEqual( [ legacy ] );
		expect( chatsOf( rows, 'b' ) ).toEqual( [ explicit ] );
		expect( rows.flatMap( ( row ) => row.chats ) ).not.toContain( removed );
	} );

	it( 'excludes pinned chats from site lists and filters archived sessions', () => {
		const old = chat( 'old', { ownerSiteId: 'a' }, '2026-10-11T10:00:00Z' );
		const newest = chat( 'new', { ownerSiteId: 'b' }, '2026-10-12T11:00:00Z' );
		const other = chat( 'other', { ownerSiteId: 'a' } );
		const { pinnedItems, chatsBySite } = collect(
			sites,
			[ newest, old, other, chat( 'archived', { ownerSiteId: 'a', archived: true } ) ],
			[ 'new', 'old' ]
		);
		expect( pinnedItems.map( ( item ) => item.session?.id ).sort() ).toEqual( [ 'new', 'old' ] );
		expect( chatsBySite.get( 'a' ) ).toEqual( [ other ] );
		expect( chatsBySite.get( 'b' ) ).toEqual( [] );
	} );

	it( 'preserves stable site and session ordering for tied or invalid dates and duplicate IDs', () => {
		const b = chat( 'b', { ownerSiteId: 'b' } );
		const a = chat( 'a', { ownerSiteId: 'a' } );
		const invalid = chat( 'invalid', { ownerSiteId: 'a' }, 'invalid' );
		const duplicate = chat( 'a', { ownerSiteId: 'b' }, '2026-10-12T11:00:00Z' );
		const sessions = [ b, a, invalid, duplicate ];
		const { rows } = collect( sites, sessions, [] );
		expect( chatsOf( rows, 'a' ) ).toEqual( [ a, invalid ] );
		expect( chatsOf( rows, 'b' ) ).toEqual( [ duplicate, b ] );
		expect( sessions ).toEqual( [ b, a, invalid, duplicate ] );
	} );

	it( 'returns empty collections for missing sites or sessions', () => {
		expect( collect( [], [ chat( 'orphan' ) ], [] ).rows ).toEqual( [] );
		const result = collect( sites, [], [] );
		expect( chatsOf( result.rows, 'a' ) ).toEqual( [] );
		expect( result.chatsBySite.get( 'a' ) ).toEqual( [] );
		expect( result.pinnedItems ).toEqual( [] );
	} );
} );
