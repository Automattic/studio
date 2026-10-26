import { describe, expect, it } from 'vitest';
import { getAiModel, isAiModelId } from '../models';
import { providerServesModel, resolveSessionModelForProvider } from '../providers';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

describe( 'models', () => {
	it.each( [
		[ 'fast', true ],
		[ 'claude-opus-5', true ],
		[ 'openrouter/deepseek/deepseek-v4-flash', true ],
		[ 'local/sees', true ],
		[ 'gpt-6', false ],
		[ '/sees', false ],
		[ 'local/', false ],
		[ 'local/has space', false ],
	] )( 'takes %s as a model: %s', ( id, taken ) => {
		expect( isAiModelId( id ) ).toBe( taken );
	} );

	it( "labels a models.json model by its reference, served by pi's registry", () => {
		expect( getAiModel( 'local/sees' ) ).toEqual( {
			id: 'local/sees',
			label: 'local/sees',
			family: 'models-json',
		} );
	} );

	it( 'keeps a models.json model whatever the provider, as it brings its own', () => {
		expect( providerServesModel( 'wpcom', 'local/sees' ) ).toBe( true );
		expect( providerServesModel( 'anthropic-api-key', 'local/sees' ) ).toBe( true );
		expect( providerServesModel( 'wpcom', 'claude-opus-5' ) ).toBe( false );
		const entries = [
			{ type: 'model_change', modelId: 'local/sees' },
		] as unknown as SessionEntry[];
		expect( resolveSessionModelForProvider( entries, 'wpcom' ) ).toBe( 'local/sees' );
	} );
} );
