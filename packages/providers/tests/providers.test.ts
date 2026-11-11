import { describe, expect, it } from 'vitest';
import {
	getAiModelProviders,
	getDefaultAiModel,
	isAiModelId,
	normalizeProviderId,
	toStoredProviderId,
} from '..';

describe( 'provider ids', () => {
	it( 'reads the id builds before `anthropic` stored, and keeps writing it', () => {
		expect( normalizeProviderId( 'anthropic-api-key' ) ).toBe( 'anthropic' );
		expect( normalizeProviderId( 'anthropic' ) ).toBe( 'anthropic' );
		expect( normalizeProviderId( 'wpcom' ) ).toBe( 'wpcom' );
		expect( normalizeProviderId( 'claude-code' ) ).toBeUndefined();
		expect( toStoredProviderId( 'anthropic' ) ).toBe( 'anthropic-api-key' );
		expect( toStoredProviderId( 'wpcom' ) ).toBe( 'wpcom' );
	} );
} );

describe( 'models', () => {
	it( 'finds the providers serving a model', () => {
		expect( getAiModelProviders( 'balanced' ) ).toEqual( [ 'wpcom' ] );
		expect( getAiModelProviders( 'claude-opus-5' ) ).toEqual( [ 'anthropic' ] );
		expect( isAiModelId( 'gpt-4' ) ).toBe( false );
	} );

	it( 'defaults to the paid model only when paid credits remain', () => {
		expect( getDefaultAiModel( 'wpcom' ) ).toBe( 'fast' );
		expect( getDefaultAiModel( 'wpcom', { canUsePaidModels: true } ) ).toBe( 'balanced' );
		expect( getDefaultAiModel( 'anthropic', { canUsePaidModels: true } ) ).toBe(
			'claude-sonnet-5'
		);
	} );
} );
