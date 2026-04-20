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

	it( 'parses a validate-quota response', () => {
		const parsed = validateQuotaResponseSchema.parse( { has_enough_quota: true } );
		expect( parsed.has_enough_quota ).toBe( true );
	} );
} );
