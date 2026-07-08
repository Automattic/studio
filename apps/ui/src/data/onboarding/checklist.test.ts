import { describe, expect, it } from 'vitest';
import {
	AGENTIC_CHECKLIST_ITEMS,
	deriveChecklistItems,
	getChecklistItems,
	isChecklistComplete,
	OVERVIEW_CHECKLIST_ITEMS,
} from './checklist';
import type { OnboardingHintsState } from '@/data/core';

describe( 'getChecklistItems', () => {
	it( 'returns the agentic set when enabled, the overview set when not', () => {
		expect( getChecklistItems( true ) ).toBe( AGENTIC_CHECKLIST_ITEMS );
		expect( getChecklistItems( false ) ).toBe( OVERVIEW_CHECKLIST_ITEMS );
	} );

	it( 'includes a chat item only in the agentic set', () => {
		expect( AGENTIC_CHECKLIST_ITEMS.some( ( item ) => item.id === 'first-agent-edit' ) ).toBe(
			true
		);
		expect( OVERVIEW_CHECKLIST_ITEMS.some( ( item ) => item.id === 'first-agent-edit' ) ).toBe(
			false
		);
	} );
} );

describe( 'deriveChecklistItems', () => {
	it( 'pre-checks create-site for endowed progress', () => {
		const items = deriveChecklistItems( AGENTIC_CHECKLIST_ITEMS, undefined );
		const createSite = items.find( ( item ) => item.id === 'create-site' );
		expect( createSite?.completed ).toBe( true );
	} );

	it( 'reflects completed items from hints', () => {
		const hints: OnboardingHintsState = {
			completedItems: { 'first-agent-edit': '2026-07-07T00:00:00.000Z' },
		};
		const items = deriveChecklistItems( AGENTIC_CHECKLIST_ITEMS, hints );
		expect( items.find( ( item ) => item.id === 'first-agent-edit' )?.completed ).toBe( true );
		expect( items.find( ( item ) => item.id === 'publish-site' )?.completed ).toBe( false );
	} );
} );

describe( 'isChecklistComplete', () => {
	it( 'is true only when every item is complete', () => {
		const hints: OnboardingHintsState = {
			completedItems: Object.fromEntries(
				AGENTIC_CHECKLIST_ITEMS.map( ( item ) => [ item.id, 'ts' ] )
			),
		};
		expect( isChecklistComplete( deriveChecklistItems( AGENTIC_CHECKLIST_ITEMS, hints ) ) ).toBe(
			true
		);
		expect(
			isChecklistComplete( deriveChecklistItems( AGENTIC_CHECKLIST_ITEMS, undefined ) )
		).toBe( false );
	} );

	it( 'is false for an empty list', () => {
		expect( isChecklistComplete( [] ) ).toBe( false );
	} );
} );
