import { __, sprintf } from '@wordpress/i18n';
import { NotConnectedError } from './errors';
import type { AiModelId } from './models';
import type { PickedModels } from './picked-models';
import type { CatalogModel } from './types';
import type { Api, Model } from '@earendil-works/pi-ai';

const dollars = ( amount: number ) => `$${ +amount.toFixed( 2 ) }`;

// What a model costs, from the dollars a million input tokens and a million output tokens cost.
export function describePrice( input: number, output: number ): string {
	return ! input && ! output
		? __( 'Free' )
		: sprintf(
				/* translators: 1: price of a million input tokens, 2: of a million output tokens, both like $3 */
				__( '%1$s / %2$s per million tokens' ),
				dollars( input ),
				dollars( output )
		  );
}

// By name, the newest of each first: `GPT-6.1 Terra` before `GPT-6 Sol`, `Sonnet 5.5` before `Sonnet 5`.
export function compareModelLabels( a: string, b: string ): number {
	const [ , nameA, versionA ] = /^(\D*)(.*)$/.exec( a )!;
	const [ , nameB, versionB ] = /^(\D*)(.*)$/.exec( b )!;
	return (
		nameA.localeCompare( nameB ) || versionB.localeCompare( versionA, undefined, { numeric: true } )
	);
}

// pi's name for a model, without the maker Studio's Claude labels leave off: `Opus 5.5`.
export const shortModelName = ( name: string ) =>
	name.replace( /^Claude /, '' ).replace( / \(latest\)$/, '' );

/**
 * The model within Studio Code's limits, its cost left to the account. Thinking takes part of a
 * reply, so the reply stays at 32K tokens: enough for a tool call that writes a whole page.
 */
export function withinStudioLimits< M extends Model< Api > >( model: M ): M {
	return {
		...model,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: Math.min( model.contextWindow, 200_000 ),
		maxTokens: Math.min( model.maxTokens, 32_000 ),
	};
}

// The picked models Studio can run, as a config stores them; at least one.
export function pickModels( picked: CatalogModel[], runs: ( id: string ) => unknown ) {
	const models = picked
		.filter( ( { id } ) => runs( id ) )
		.map( ( { id, label } ) => ( { id, label } ) );
	if ( ! models.length ) {
		throw new Error( __( 'Pick at least one model.' ) );
	}
	return models;
}

// A model's version from its id's numbers, such as 6 and 1 for `gpt-6.1-terra`.
export const versionOf = ( major: string, minor = '0' ) => Number( major ) * 100 + Number( minor );

// What a provider's list of models answers; nothing when it refuses.
export async function fetchModelList< Body >(
	url: string,
	headers: Record< string, string >
): Promise< Body | undefined > {
	const response = await fetch( url, { headers, signal: AbortSignal.timeout( 15_000 ) } );
	return response.ok ? ( ( await response.json() ) as Body ) : undefined;
}

/**
 * The catalog of a provider pi runs: the models pi knows how to call, narrowed by the account's
 * own list, so a new model comes with a pi upgrade. Studio runs those that reason, offers a
 * preview or a dated snapshot only when its release isn't listed, and recommends the newest of
 * each family Studio lists.
 */
export function piCatalog< Config extends PickedModels >( {
	piModels,
	parse,
	studioModels,
	listAccountModels,
	showsPrices = () => true,
	notConnected,
}: {
	piModels: Partial< Record< string, Model< Api > > >;
	// The family and version a chat model's id names; nothing for an alias or a model made for one
	// task.
	parse: ( id: string ) => { family: string; version: number } | undefined;
	studioModels: readonly { id: string }[];
	// The models the account may use, with what the provider says each is for; nothing when it
	// doesn't list them, and the catalog is then all of pi's.
	listAccountModels: (
		config: Config
	) => Promise< { id: string; description?: string }[] | undefined >;
	// Whether the account pays by the token, so its models show their price.
	showsPrices?: ( config: Config ) => boolean;
	notConnected: string;
} ) {
	const find = ( id: string ) => {
		const model = parse( id ) ? piModels[ id ] : undefined;
		return model?.reasoning ? model : undefined;
	};
	const families = studioModels.flatMap( ( { id } ) => parse( id )?.family ?? [] );

	return {
		run( id: string ) {
			const model = find( id );
			return model && withinStudioLimits( model );
		},
		async listModels( config: Config | undefined ): Promise< CatalogModel[] > {
			if ( ! config ) {
				throw new NotConnectedError( notConnected );
			}
			const account = await listAccountModels( config ).catch( () => undefined );
			const listed = account?.length
				? account
				: Object.keys( piModels ).map( ( id ): { id: string; description?: string } => ( { id } ) );
			const ids = new Set( listed.map( ( { id } ) => id ) );
			const newest = new Map< string, { id: string; version: number } >();
			const models = new Map< string, CatalogModel >();
			for ( const { id, description } of listed ) {
				const model = find( id );
				const release = id.replace( /-(?:preview|\d{8})$/, '' );
				if ( ! model || models.has( id ) || ( release !== id && ids.has( release ) ) ) {
					continue;
				}
				models.set( id, {
					id: id as AiModelId,
					label: shortModelName( model.name ),
					supportsImages: model.input.includes( 'image' ),
					reasoning: true,
					details: showsPrices( config )
						? describePrice( model.cost.input, model.cost.output )
						: description,
				} );
				const { family, version } = parse( id )!;
				if ( families.includes( family ) && version > ( newest.get( family )?.version ?? -1 ) ) {
					newest.set( family, { id, version } );
				}
			}
			const recommended = new Set( [ ...newest.values() ].map( ( { id } ) => id ) );
			return [ ...models.values() ]
				.map( ( model ) => ( { ...model, recommended: recommended.has( model.id ) } ) )
				.sort( ( a, b ) => compareModelLabels( a.label, b.label ) );
		},
		selectModels( config: Config, picked: CatalogModel[] ): Config {
			return { ...config, models: pickModels( picked, find ) };
		},
	};
}
