import { z } from 'zod';

export const githubCopilotConfigSchema = z.object( {
	method: z.literal( 'github' ),
	// The GitHub sign-in, which doesn't expire; it renews the Copilot token.
	githubToken: z.string().min( 1 ),
	copilotToken: z.string().min( 1 ),
	copilotTokenExpiresAt: z.number(),
	login: z.string().optional(),
} );

export type GithubCopilotConfig = z.infer< typeof githubCopilotConfigSchema >;
