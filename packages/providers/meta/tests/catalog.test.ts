import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAiModels } from '../../models';
import { metaAi } from '../ai';
import { metaProvider } from '../descriptor';

const config = { apiKey: 'LLM_test' };

describe( 'meta catalog', () => {
	const fetchMock = vi.fn();

	beforeEach( () => {
		vi.stubGlobal( 'fetch', fetchMock );
	} );

	afterEach( () => {
		fetchMock.mockReset();
		vi.unstubAllGlobals();
	} );

	it( 'lists the Muse models the key may use that pi knows, the newest of each family recommended', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(
				JSON.stringify( {
					data: [
						{ id: 'muse-spark-1.3' },
						{ id: 'muse-spark-1.2' },
						{ id: 'muse-spark-1.3-contributor' },
						{ id: 'muse-spark-2.0' },
					],
				} )
			)
		);

		const models = await metaAi.listModels!( config );

		expect( fetchMock ).toHaveBeenCalledWith(
			'https://api.meta.ai/v1/models',
			expect.objectContaining( { headers: { Authorization: 'Bearer LLM_test' } } )
		);
		expect( models ).toEqual( [
			expect.objectContaining( {
				id: 'muse-spark-1.3-contributor',
				details: '$0.1 / $0.2 per million tokens',
				recommended: false,
			} ),
			expect.objectContaining( {
				id: 'muse-spark-1.3',
				label: 'Muse Spark 1.3',
				recommended: true,
			} ),
			expect.objectContaining( { id: 'muse-spark-1.2', recommended: false } ),
		] );
	} );

	it( 'offers the models the user picked', async () => {
		const picked = await metaAi.selectModels!( config, [
			{ id: 'muse-spark-1.2', label: 'Muse Spark 1.2', supportsImages: true },
		] );

		expect(
			getAiModels( 'meta', metaProvider.account!.describe( picked ) ).map( ( model ) =>
				model.label()
			)
		).toEqual( [ 'Muse Spark 1.2' ] );
		await expect( metaAi.model( picked, 'muse-spark-1.2', {} ) ).resolves.toMatchObject( {
			model: { id: 'muse-spark-1.2', maxTokens: 32_000, contextWindow: 200_000 },
		} );
	} );
} );
