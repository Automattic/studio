import { z } from 'zod';
import { pickedModelsSchema } from '../picked-models';

export const githubCopilotConfigSchema = z.object( {
	method: z.literal( 'github' ),
	// The GitHub sign-in, which doesn't expire; it renews the Copilot token.
	githubToken: z.string().min( 1 ),
	copilotToken: z.string().min( 1 ),
	copilotTokenExpiresAt: z.number(),
	login: z.string().optional(),
	// The models the plan runs, re-read whenever the Copilot token is renewed.
	models: z.array( z.string() ).optional(),
	// The models the user picked from the plan's; Studio's until they pick.
	picked: pickedModelsSchema,
} );

export type GithubCopilotConfig = z.infer< typeof githubCopilotConfigSchema >;
