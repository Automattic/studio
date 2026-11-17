import { z } from 'zod';

export const localLlmConfigSchema = z.object( {
	method: z.literal( 'server' ),
	// The server's OpenAI-compatible API, ending in `/v1`.
	baseUrl: z.string().min( 1 ),
	// Sent as a Bearer token; absent for a server that takes none.
	apiKey: z.string().min( 1 ).optional(),
	// The server's name for the model new chats start on until the user picks one.
	model: z.string().min( 1 ),
} );

export type LocalLlmConfig = z.infer< typeof localLlmConfigSchema >;
