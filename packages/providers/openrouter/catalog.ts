import { __, sprintf } from '@wordpress/i18n';
import { NotConnectedError } from '../errors';
import { describePrice } from '../catalog';
import { OPENROUTER_API_URL } from './api';
import { OPENROUTER_AI_MODELS, OPENROUTER_MODEL_PREFIX } from './descriptor';
import type { OpenrouterConfig, OpenrouterPickedModel } from './config';
import type { AiModelId } from '../models';
import type { CatalogModel, ProviderServices } from '../types';

type OpenrouterAi = NonNullable< ProviderServices< OpenrouterConfig >[ 'ai' ] >;

interface ListedModel {
	id: string;
	name: string;
	context_length?: number;
	architecture?: { input_modalities?: string[]; output_modalities?: string[] };
	pricing?: { prompt?: string; completion?: string };
	top_provider?: { max_completion_tokens?: number | null };
	supported_parameters?: string[];
}

const RECOMMENDED: readonly string[] = OPENROUTER_AI_MODELS.map( ( { id } ) => id );

const toId = ( slug: string ) => `${ OPENROUTER_MODEL_PREFIX }${ slug }` as AiModelId;

// The chat models the key may use that can call Studio Code's tools.
async function fetchModels( apiKey: string ): Promise< ListedModel[] > {
	const response = await fetch( `${ OPENROUTER_API_URL }/models/user`, {
		headers: { Authorization: `Bearer ${ apiKey }` },
		signal: AbortSignal.timeout( 15_000 ),
	} );
	if ( ! response.ok ) {
		throw new Error( `OpenRouter's model list failed: HTTP ${ response.status }` );
	}
	const { data } = ( await response.json() ) as { data?: ListedModel[] };
	return ( data ?? [] ).filter(
		( model ) =>
			model.supported_parameters?.includes( 'tools' ) &&
			model.architecture?.output_modalities?.includes( 'text' )
	);
}

const takesImages = ( model: ListedModel ) =>
	model.architecture?.input_modalities?.includes( 'image' ) ?? false;

function formatTokens( count: number ): string {
	return count >= 1_000_000
		? `${ +( count / 1_000_000 ).toFixed( 1 ) }M`
		: `${ Math.round( count / 1000 ) }K`;
}

function describeModel( { pricing, context_length }: ListedModel ): string {
	const price = describePrice(
		Number( pricing?.prompt ?? 0 ) * 1_000_000,
		Number( pricing?.completion ?? 0 ) * 1_000_000
	);
	return context_length
		? sprintf(
				/* translators: 1: a model's price, 2: its context size, like 200K */
				__( '%1$s · %2$s context' ),
				price,
				formatTokens( context_length )
		  )
		: price;
}

const rank = ( id: string ) => {
	const index = RECOMMENDED.indexOf( id );
	return index === -1 ? RECOMMENDED.length : index;
};

// Studio's recommended models first, then the rest by name.
export const listOpenrouterModels: NonNullable< OpenrouterAi[ 'listModels' ] > = async (
	config
) => {
	if ( ! config ) {
		throw new NotConnectedError( 'Connect OpenRouter to see its models.' );
	}
	return ( await fetchModels( config.apiKey ) )
		.map(
			( model ): CatalogModel => ( {
				id: toId( model.id ),
				label: model.name,
				supportsImages: takesImages( model ),
				reasoning: model.supported_parameters?.includes( 'reasoning' ) ?? false,
				contextWindow: model.context_length,
				maxTokens: model.top_provider?.max_completion_tokens ?? undefined,
				details: describeModel( model ),
				recommended: RECOMMENDED.includes( toId( model.id ) ),
			} )
		)
		.sort( ( a, b ) => rank( a.id ) - rank( b.id ) || a.label.localeCompare( b.label ) );
};

export const selectOpenrouterModels: NonNullable< OpenrouterAi[ 'selectModels' ] > = (
	config,
	picked
) => {
	const models = picked.flatMap( ( model ): OpenrouterPickedModel[] =>
		model.id.startsWith( OPENROUTER_MODEL_PREFIX )
			? [
					{
						slug: model.id.slice( OPENROUTER_MODEL_PREFIX.length ),
						label: model.label,
						images: model.supportsImages,
						reasoning: model.reasoning ?? false,
						contextWindow: model.contextWindow ?? 128_000,
						maxTokens: model.maxTokens,
					},
			  ]
			: []
	);
	if ( ! models.length ) {
		throw new Error( __( 'Pick at least one model OpenRouter offers.' ) );
	}
	return { ...config, models };
};
