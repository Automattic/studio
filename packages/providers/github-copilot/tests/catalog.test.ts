import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAiModels } from '../../models';
import { githubCopilotAccount } from '../account';
import { githubCopilotAi } from '../ai';
import { githubCopilotProvider } from '../descriptor';
import type { GithubCopilotConfig } from '../config';

const json = ( status: number, body: unknown = {} ) =>
	new Response( JSON.stringify( body ), { status } );

const copilotToken = 'tid=1;exp=2;proxy-ep=proxy.individual.githubcopilot.com;';

const config: GithubCopilotConfig = {
	method: 'github',
	githubToken: 'gho_1',
	copilotToken,
	copilotTokenExpiresAt: Date.now() + 60 * 60_000,
};

const planModel = ( id: string, policy: string, category = 'versatile' ) => ( {
	id,
	model_picker_enabled: true,
	policy: { state: policy },
	model_picker_category: category,
} );

const plan = {
	data: [
		planModel( 'claude-sonnet-5.5', 'enabled' ),
		planModel( 'claude-sonnet-5', 'enabled' ),
		planModel( 'gpt-5.4-nano', 'unconfigured', 'lightweight' ),
		planModel( 'claude-haiku-4.5', 'enabled', 'lightweight' ),
		// Neither one Studio can run, as pi doesn't know it, nor one the plan turned off.
		planModel( 'gpt-4.1', 'enabled' ),
		planModel( 'grok-4.7', 'disabled', 'powerful' ),
	],
};

const labels = ( models: { label: string }[] ) => models.map( ( { label } ) => label );

describe( 'github-copilot catalog', () => {
	const fetchMock = vi.fn();
	const respond = ( routes: Record< string, () => Response > ) =>
		fetchMock.mockImplementation( async ( url: string ) => {
			const route = Object.keys( routes ).find( ( path ) => url.endsWith( path ) );
			return route ? routes[ route ]() : json( 200 );
		} );

	beforeEach( () => {
		vi.stubGlobal( 'fetch', fetchMock );
	} );

	afterEach( () => {
		fetchMock.mockReset();
		vi.unstubAllGlobals();
	} );

	it( 'lists the models the plan runs, by maker and newest first, with how Copilot sorts them', async () => {
		respond( { '/models': () => json( 200, plan ) } );

		const models = await githubCopilotAi.listModels!( config );

		expect( models ).toEqual( [
			expect.objectContaining( {
				id: 'claude-haiku-4-5',
				label: 'Haiku 4.5',
				details: 'Lightweight',
				recommended: false,
			} ),
			expect.objectContaining( {
				id: 'claude-sonnet-5-5',
				label: 'Sonnet 5.5',
				supportsImages: true,
				details: 'Versatile',
				recommended: true,
			} ),
			expect.objectContaining( { id: 'claude-sonnet-5', label: 'Sonnet 5' } ),
			// One the plan leaves off until it is turned on.
			expect.objectContaining( { id: 'gpt-5.4-nano', details: 'Lightweight' } ),
		] );
	} );

	it( 'lists every model pi knows when Copilot doesn’t say which the plan runs', async () => {
		respond( { '/models': () => json( 500 ) } );

		const models = await githubCopilotAi.listModels!( config );

		expect( models.length ).toBeGreaterThan( 20 );
		expect( labels( models.filter( ( model ) => model.recommended ) ) ).toEqual( [
			'Sonnet 5.5',
			'GPT-6.1 Terra',
			'Gemini 4 Argon',
		] );
	} );

	it( 'turns on a picked model the plan leaves off, and offers the picks it runs', async () => {
		respond( { '/models': () => json( 200, plan ) } );
		const models = await githubCopilotAi.listModels!( config );

		const picked = await githubCopilotAi.selectModels!(
			config,
			models.filter( ( { id } ) => id === 'gpt-5.4-nano' || id === 'claude-haiku-4-5' )
		);

		expect( fetchMock ).toHaveBeenCalledWith(
			'https://api.individual.githubcopilot.com/models/gpt-5.4-nano/policy',
			expect.objectContaining( { method: 'POST' } )
		);
		const account = githubCopilotProvider.account!.describe( picked );
		expect( getAiModels( 'github-copilot', account ).map( ( model ) => model.label() ) ).toEqual( [
			'Haiku 4.5',
			'GPT-5.4 nano',
		] );
		await expect( githubCopilotAi.model( picked, 'gpt-5.4-nano', {} ) ).resolves.toMatchObject( {
			model: { id: 'gpt-5.4-nano', api: 'openai-responses' },
		} );

		// A pick the plan no longer runs stops being offered.
		const renewed = { ...picked, models: [ 'claude-haiku-4-5' ] };
		expect( githubCopilotProvider.account!.describe( renewed ).models ).toEqual( [
			{ id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
		] );
	} );

	it( 'offers a plan’s own models when it runs none of Studio’s', async () => {
		respond( {
			'/login/oauth/access_token': () => json( 200, { access_token: 'gho_1' } ),
			'/copilot_internal/v2/token': () => json( 200, { token: copilotToken, expires_at: 2000 } ),
			'/models': () => json( 200, { data: [ planModel( 'claude-haiku-4.5', 'enabled' ) ] } ),
		} );

		const connected = await githubCopilotAccount.connect( 'github', {
			deviceCode: 'device',
			interval: '0.001',
			expiresAt: String( Date.now() + 60_000 ),
		} );

		expect( githubCopilotProvider.account!.describe( connected ).models ).toEqual( [
			{ id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
		] );
	} );
} );
