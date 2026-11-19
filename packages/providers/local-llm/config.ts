import { z } from 'zod';

// A model picked from the server's list.
const pickedModelSchema = z.object( {
	// The server's name for it.
	name: z.string().min( 1 ),
	images: z.boolean(),
} );

export const localLlmConfigSchema = z.object( {
	method: z.literal( 'server' ),
	// The server's OpenAI-compatible API, ending in `/v1`.
	baseUrl: z.string().min( 1 ),
	// Sent as a Bearer token; absent for a server that takes none.
	apiKey: z.string().min( 1 ).optional(),
	// The models chat offers; new chats start on the first.
	models: z.array( pickedModelSchema ).min( 1 ),
} );

export type LocalLlmConfig = z.infer< typeof localLlmConfigSchema >;

// The models chat offers, those the server says call tools first, since new chats start on the
// first: Ollama lists the model pulled last first, which may be one that can't.
export function toConfigModels(
	models: { name: string; images: boolean; tools?: boolean }[]
): LocalLlmConfig[ 'models' ] {
	return [
		...models.filter( ( model ) => model.tools ),
		...models.filter( ( model ) => ! model.tools ),
	].map( ( { name, images } ) => ( { name, images } ) );
}
