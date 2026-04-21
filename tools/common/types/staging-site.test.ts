import { describe, it, expect } from 'vitest';
import {
	listStagingSitesResponseSchema,
	createStagingSiteResponseSchema,
	syncStateResponseSchema,
	validateQuotaResponseSchema,
} from './staging-site';

describe( 'staging-site schemas', () => {
	it( 'parses a list response', () => {
		const parsed = listStagingSitesResponseSchema.parse( [
			{
				id: 123,
				name: 'Staging',
				url: 'https://staging-123-foo.wpcomstaging.com',
			},
		] );
		expect( parsed.length ).toBe( 1 );
	} );

	it( 'parses a create response', () => {
		const parsed = createStagingSiteResponseSchema.parse( {
			id: 123,
			name: 'Site Title',
			url: 'http://staging-123456-sitename.wordpress.com',
		} );
		expect( parsed.id ).toBe( 123 );
	} );

	it( 'parses a sync-state response', () => {
		const parsed = syncStateResponseSchema.parse( {
			status: 'in-progress',
			started_at: '2026-04-20T00:00:00Z',
		} );
		expect( parsed.status ).toBe( 'in-progress' );
	} );

	it( 'parses a validate-quota response in object form', () => {
		const parsed = validateQuotaResponseSchema.parse( { has_enough_quota: true } );
		expect( parsed ).toEqual( { has_enough_quota: true } );
	} );

	it( 'parses a validate-quota response in bare-boolean form', () => {
		expect( validateQuotaResponseSchema.parse( true ) ).toBe( true );
		expect( validateQuotaResponseSchema.parse( false ) ).toBe( false );
	} );
} );
