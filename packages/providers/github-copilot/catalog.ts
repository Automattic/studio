import { GITHUB_COPILOT_MODELS } from '@earendil-works/pi-ai/providers/github-copilot.models';
import { __ } from '@wordpress/i18n';
import { compareModelLabels, pickModels, shortModelName } from '../catalog';
import { NotConnectedError } from '../errors';
import { enablePlanModel, fetchPlanModels, type PlanModel } from './api';
import { GITHUB_COPILOT_AI_MODELS, GITHUB_COPILOT_MODEL_PREFIXES } from './descriptor';
import type { GithubCopilotConfig } from './config';
import type { AiModelId } from '../models';
import type { CatalogModel, ProviderServices } from '../types';
import type { Api, Model } from '@earendil-works/pi-ai';

type GithubCopilotAi = NonNullable< ProviderServices< GithubCopilotConfig >[ 'ai' ] >;

const PI_MODELS = GITHUB_COPILOT_MODELS as Partial< Record< string, Model< Api > > >;

export const DEFAULT_MODEL_IDS: readonly string[] = GITHUB_COPILOT_AI_MODELS.map(
	( { id } ) => id
);

// Copilot names Claude models with dots where Studio's ids, shared with Anthropic, use dashes.
export function toCopilotModelId( id: string ): string {
	return id.startsWith( 'claude-' ) ? id.replace( /(\d)-(\d)/g, '$1.$2' ) : id;
}

function fromCopilotModelId( id: string ): AiModelId {
	return ( id.startsWith( 'claude-' ) ? id.replace( /(\d)\.(\d)/g, '$1-$2' ) : id ) as AiModelId;
}

const makerOf = ( id: string ) =>
	GITHUB_COPILOT_MODEL_PREFIXES.findIndex( ( prefix ) => id.startsWith( prefix ) );

// What pi knows of a model Copilot runs: Studio runs only those, as pi says how each one thinks.
export function findPiModel( id: string ): Model< Api > | undefined {
	return makerOf( id ) < 0 ? undefined : PI_MODELS[ toCopilotModelId( id ) ];
}

export function labelOf( id: string ): string {
	const model = findPiModel( id );
	return model ? shortModelName( model.name ) : id;
}

// The plan's models that Studio can run, the way Copilot's own clients pick them.
function runnable( plan: PlanModel[] ): PlanModel[] {
	// Copilot marks what a plan offers with the picker its own clients show. Some accounts leave
	// that off on every model, and there the policy alone says what the plan runs.
	const usesPicker = plan.some( ( model ) => model.offered );
	return plan.filter(
		( model ) =>
			model.policy !== 'disabled' &&
			( ! usesPicker || model.offered ) &&
			findPiModel( fromCopilotModelId( model.id ) )
	);
}

/**
 * The models the plan runs: a plan includes its own set, and leaves some of them off until they
 * are turned on, which Studio does for the ones `wanted`. Undefined when Copilot doesn't say, so
 * that a reply Studio can't read never hides a model the plan does include.
 */
export async function readPlanModels(
	copilotToken: string,
	wanted: readonly string[]
): Promise< AiModelId[] | undefined > {
	const plan = await fetchPlanModels( copilotToken );
	if ( ! plan ) {
		return undefined;
	}
	const models = await Promise.all(
		runnable( plan ).map( async ( model ) => {
			const id = fromCopilotModelId( model.id );
			const runs =
				model.policy !== 'unconfigured' ||
				( wanted.includes( id ) && ( await enablePlanModel( copilotToken, model.id ) ) );
			return runs ? [ id ] : [];
		} )
	);
	return models.flat();
}

// How Copilot's own model picker sorts the model.
function describeCategory( category: string | undefined ): string | undefined {
	switch ( category ) {
		case 'lightweight':
			return __( 'Lightweight' );
		case 'versatile':
			return __( 'Versatile' );
		case 'powerful':
			return __( 'Powerful' );
	}
	return undefined;
}

// By maker, then by name, the newest of each first.
const byMakerAndName = ( a: CatalogModel, b: CatalogModel ) =>
	makerOf( a.id ) - makerOf( b.id ) || compareModelLabels( a.label, b.label );

/**
 * Every model the plan runs that Studio can run, Studio's own recommended, or every one pi knows
 * when Copilot doesn't say.
 */
export const listCopilotModels: NonNullable< GithubCopilotAi[ 'listModels' ] > = async (
	config
) => {
	if ( ! config ) {
		throw new NotConnectedError( 'Sign in with GitHub to see your Copilot plan’s models.' );
	}
	const plan = await fetchPlanModels( config.copilotToken );
	const listed: { id: string; category?: string }[] = plan
		? runnable( plan )
		: Object.keys( PI_MODELS ).map( ( id ) => ( { id } ) );
	const models = new Map< string, CatalogModel >();
	for ( const { id: copilotId, category } of listed ) {
		const id = fromCopilotModelId( copilotId );
		const model = findPiModel( id );
		if ( model && ! models.has( id ) ) {
			models.set( id, {
				id,
				label: labelOf( id ),
				supportsImages: model.input.includes( 'image' ),
				reasoning: model.reasoning,
				details: describeCategory( category ),
				recommended: DEFAULT_MODEL_IDS.includes( id ),
			} );
		}
	}
	return [ ...models.values() ].sort( byMakerAndName );
};

// Picking a model the plan leaves off turns it on, as picking it in Copilot Chat does.
export const selectCopilotModels: NonNullable< GithubCopilotAi[ 'selectModels' ] > = async (
	config,
	picked
) => {
	const models = pickModels( picked, findPiModel );
	const runs = await readPlanModels(
		config.copilotToken,
		models.map( ( { id } ) => id )
	);
	return { ...config, picked: models, models: runs };
};
