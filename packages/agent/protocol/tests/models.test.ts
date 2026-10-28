import { describe, expect, it } from 'vitest';
import { getAiModel, isAiModelId, toCustomModelId } from '../models';
import {
	getEffectiveSessionProvider,
	providerServesModel,
	resolveSessionModelForProvider,
} from '../providers';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

describe( 'models', () => {
	it.each( [
		[ 'fast', true ],
		[ 'claude-opus-5', true ],
		[ 'custom:glm-5.3-flash', true ],
		[ 'custom:vendor/model', true ],
		[ 'gpt-6', false ],
		[ 'custom:', false ],
		[ 'custom:has space', false ],
		[ 'local/sees', false ],
	] )( 'takes %s as a model: %s', ( id, taken ) => {
		expect( isAiModelId( id ) ).toBe( taken );
	} );

	it( "labels a custom model by its endpoint's name for it", () => {
		expect( getAiModel( toCustomModelId( 'vendor/model' ) ) ).toEqual( {
			id: 'custom:vendor/model',
			label: 'vendor/model',
			family: 'custom',
		} );
	} );

	it( 'serves a custom model only on the custom endpoint, and its models on no other', () => {
		expect( providerServesModel( 'custom-endpoint', 'custom:m' ) ).toBe( true );
		expect( providerServesModel( 'wpcom', 'custom:m' ) ).toBe( false );
		expect( providerServesModel( 'anthropic-api-key', 'custom:m' ) ).toBe( false );
		expect( providerServesModel( 'custom-endpoint', 'fast' ) ).toBe( false );
		const entries = [ { type: 'model_change', modelId: 'custom:m' } ] as unknown as SessionEntry[];
		expect( resolveSessionModelForProvider( entries, 'custom-endpoint' ) ).toBe( 'custom:m' );
		expect( resolveSessionModelForProvider( entries, 'wpcom' ) ).toBe( 'fast' );
	} );

	it( 'runs the app on WordPress.com for the custom endpoint, which only the CLI connects', () => {
		const settings = { provider: 'custom-endpoint' as const, hasAnthropicApiKey: true };
		expect( getEffectiveSessionProvider( [], settings ) ).toBe( 'wpcom' );
		expect(
			getEffectiveSessionProvider( [], { ...settings, provider: 'anthropic-api-key' } )
		).toBe( 'anthropic-api-key' );
		expect(
			getEffectiveSessionProvider( [], {
				provider: 'anthropic-api-key',
				hasAnthropicApiKey: false,
			} )
		).toBe( 'wpcom' );
	} );
} );
