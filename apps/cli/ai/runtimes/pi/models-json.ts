import fs from 'fs';
import {
	type Api,
	type Credential,
	type CredentialInfo,
	type CredentialStore,
	type Model,
} from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { getModelsPath } from '@studio/common/lib/well-known-paths';
import type { ModelsJsonModelId } from '@studio/common/ai/models';

/** A turn's model and the runtime that serves it. */
export interface TurnModel {
	model: Model< Api >;
	modelRuntime: ModelRuntime;
}

// In-memory credential store so the runtime never reads or writes an auth.json
// on disk. Studio resolves credentials from the environment on every turn and
// injects them via runtime API keys or registered provider configs, so nothing
// needs to be persisted.
export class InMemoryCredentialStore implements CredentialStore {
	private readonly credentials = new Map< string, Credential >();

	async read( providerId: string ): Promise< Credential | undefined > {
		return this.credentials.get( providerId );
	}

	async list(): Promise< readonly CredentialInfo[] > {
		return [ ...this.credentials.entries() ].map( ( [ providerId, credential ] ) => ( {
			providerId,
			type: credential.type,
		} ) );
	}

	async modify(
		providerId: string,
		fn: ( current: Credential | undefined ) => Promise< Credential | undefined >
	): Promise< Credential | undefined > {
		const next = await fn( this.credentials.get( providerId ) );
		if ( next ) {
			this.credentials.set( providerId, next );
		}
		return next;
	}

	async delete( providerId: string ): Promise< void > {
		this.credentials.delete( providerId );
	}
}

const createRuntime = () =>
	ModelRuntime.create( {
		credentials: new InMemoryCredentialStore(),
		modelsPath: getModelsPath(),
	} );

// A provider/model reference, resolved by pi's model registry from the
// models.json (docs/models.md in @earendil-works/pi-coding-agent), which also
// holds pi's built-in providers, with the API, address, headers and key it
// gives. The key of a built-in provider comes from its environment variable,
// as OPENROUTER_API_KEY; nothing is read from or written to an auth.json.
export async function resolveModelsJsonModel(
	id: ModelsJsonModelId
): Promise< ( { ok: true } & TurnModel ) | { ok: false; reason: string } > {
	const modelsPath = getModelsPath();
	const modelRuntime = await createRuntime();
	const slash = id.indexOf( '/' );
	const model = modelRuntime.getModel( id.slice( 0, slash ), id.slice( slash + 1 ) );
	if ( ! model ) {
		const error = modelRuntime.getError();
		return {
			ok: false,
			reason: `${ id } is not a model of a provider in ${ modelsPath } or of pi's built-in providers${
				error ? ` (${ error })` : ''
			}.`,
		};
	}
	return { ok: true, model, modelRuntime };
}

/** The models of the providers models.json names, by their provider/model references. */
export async function readModelsJsonModels(): Promise< ModelsJsonModelId[] > {
	let providers: string[];
	try {
		providers = Object.keys(
			JSON.parse( await fs.promises.readFile( getModelsPath(), 'utf8' ) ).providers ?? {}
		);
	} catch {
		return [];
	}
	const modelRuntime = await createRuntime();
	return providers.flatMap( ( provider ) =>
		modelRuntime
			.getModels( provider )
			.map( ( model ): ModelsJsonModelId => `${ provider }/${ model.id }` )
	);
}
