/**
 * The frontend half of a headless site.
 *
 * A headless site is a normal Studio site (WordPress, served by the native PHP
 * server) plus a frontend project Studio supervises: either a folder of static
 * files Studio serves itself, or a dev server started with a command. The
 * record lives on the site in `cli.json`, so the CLI can start and stop it,
 * and travels to both front ends with the rest of the site details.
 */
import { __ } from '@wordpress/i18n';
import { z } from 'zod';

export const siteFrontendKindSchema = z.enum( [ 'static', 'command' ] );
export type SiteFrontendKind = z.infer< typeof siteFrontendKindSchema >;

export const siteFrontendFrameworkSchema = z.enum( [ 'static', 'astro', 'next', 'custom' ] );
export type SiteFrontendFramework = z.infer< typeof siteFrontendFrameworkSchema >;

export const siteFrontendApiSchema = z.enum( [ 'rest', 'graphql' ] );
export type SiteFrontendApi = z.infer< typeof siteFrontendApiSchema >;

export const siteFrontendSchema = z
	.object( {
		// The frontend project directory: what an editor or the agent opens.
		path: z.string(),
		// `static`: Studio serves `servedDir` itself. `command`: Studio runs `devCommand`.
		kind: siteFrontendKindSchema,
		framework: siteFrontendFrameworkSchema.optional(),
		// Started through the user's login shell from `path`. `${port}` is replaced
		// with the allocated port; the same value is also passed as `PORT`.
		devCommand: z.string().optional(),
		// Static kind only: the folder served, relative to `path` (e.g. `public`).
		servedDir: z.string().optional(),
		// Allocated once by the CLI and kept stable across restarts.
		port: z.number(),
		customDomain: z.string().optional(),
		// Which API the template was generated for. REST is always available.
		api: siteFrontendApiSchema.optional(),
		// Redirect WordPress's own front end (not admin, API or assets) to the frontend.
		headlessMode: z.boolean().optional(),
		// Shared with the frontend's `.env.local`; read by the headless mu-plugin.
		previewSecret: z.string().optional(),
		revalidateSecret: z.string().optional(),
	} )
	.loose();

export type SiteFrontend = z.infer< typeof siteFrontendSchema >;

// The frameworks a new headless site can be created with (`custom` is only for
// attached projects). The CLI flag's choices, the HTTP route's validation and
// the create form all derive from this schema.
export const frontendCreateFrameworkSchema = siteFrontendFrameworkSchema.exclude( [ 'custom' ] );

// What a user picks when creating a headless site; everything else in the
// `SiteFrontend` record is derived by the CLI. Shared by the create form, the
// connectors, `buildSiteCreateArgs` (`--frontend <framework> --frontend-api <api>`)
// and the CLI's `CreateCommandOptions`.
export const frontendCreateChoiceSchema = z.object( {
	framework: frontendCreateFrameworkSchema,
	api: siteFrontendApiSchema.optional(),
} );
export type FrontendCreateChoice = z.infer< typeof frontendCreateChoiceSchema >;

// A user-facing name for a frontend framework, the same in every surface.
export function getFrontendFrameworkLabel( framework: SiteFrontendFramework | undefined ): string {
	switch ( framework ) {
		case 'static':
			return __( 'Static HTML' );
		case 'astro':
			return 'Astro';
		case 'next':
			return 'Next.js';
		default:
			return __( 'Custom' );
	}
}

// The folder names of a headless site created with the default layout: a
// container holding `wordpress/` (the site record's `path`) and `frontend/`.
// The CLI joins them (`apps/cli/lib/frontend/layout.ts`); this module stays
// free of Node imports so the renderer can use it.
export const HEADLESS_WORDPRESS_SUBDIR = 'wordpress';
export const HEADLESS_FRONTEND_SUBDIR = 'frontend';

// The least-privilege WordPress user the frontend authenticates as.
export const HEADLESS_FRONTEND_USER = 'studio-frontend';
export const HEADLESS_APPLICATION_NAME = 'Studio frontend';

// Routes the frontend templates implement; the headless mu-plugin calls them.
export const HEADLESS_ROUTES = {
	draft: '/api/draft',
	revalidate: '/api/revalidate',
} as const;

// Header carrying the revalidation secret (never the query string).
export const REVALIDATE_SECRET_HEADER = 'X-Studio-Revalidate-Secret';

// The env contract Studio writes to the frontend's `.env.local` and injects into
// the dev server process. `WORDPRESS_URL` matches Spacefast's WordPress data
// sources and `next-wp`, so a template runs unchanged on both.
export const FRONTEND_ENV = {
	WORDPRESS_URL: 'WORDPRESS_URL',
	WORDPRESS_HOSTNAME: 'WORDPRESS_HOSTNAME',
	WORDPRESS_GRAPHQL_URL: 'WORDPRESS_GRAPHQL_URL',
	WORDPRESS_APPLICATION_USER: 'WORDPRESS_APPLICATION_USER',
	WORDPRESS_APPLICATION_PASSWORD: 'WORDPRESS_APPLICATION_PASSWORD',
	STUDIO_PREVIEW_SECRET: 'STUDIO_PREVIEW_SECRET',
	STUDIO_REVALIDATE_SECRET: 'STUDIO_REVALIDATE_SECRET',
	PORT: 'PORT',
} as const;

// The frontend record as the apps and `site list` may see it: the secrets stay
// in `cli.json` and the frontend's `.env.local`.
export function omitFrontendSecrets( frontend: SiteFrontend ): SiteFrontend {
	const { previewSecret, revalidateSecret, ...rest } = frontend;
	void previewSecret;
	void revalidateSecret;
	return rest;
}

export function isHeadlessSite< T extends { frontend?: SiteFrontend | undefined } >(
	site: T
): site is T & { frontend: SiteFrontend } {
	return Boolean( site.frontend );
}

export function getFrontendUrl( frontend: Pick< SiteFrontend, 'port' | 'customDomain' > ): string {
	if ( frontend.customDomain ) {
		return `http://${ frontend.customDomain }`;
	}
	return `http://localhost:${ frontend.port }`;
}

export function resolveDevCommand( devCommand: string, port: number ): string {
	return devCommand.split( '${port}' ).join( String( port ) );
}

export interface FrontendEnvInput {
	siteUrl: string;
	frontend: Pick< SiteFrontend, 'port' | 'api' | 'previewSecret' | 'revalidateSecret' >;
	applicationUser?: string;
	applicationPassword?: string;
}

// The variables every template receives. Server-side secrets are included; a
// template must never expose them under a public prefix.
export function buildFrontendEnv( input: FrontendEnvInput ): Record< string, string > {
	const siteUrl = input.siteUrl.replace( /\/$/, '' );
	const env: Record< string, string > = {
		[ FRONTEND_ENV.WORDPRESS_URL ]: siteUrl,
		[ FRONTEND_ENV.WORDPRESS_HOSTNAME ]: new URL( siteUrl ).hostname,
		[ FRONTEND_ENV.PORT ]: String( input.frontend.port ),
	};
	if ( input.frontend.api === 'graphql' ) {
		env[ FRONTEND_ENV.WORDPRESS_GRAPHQL_URL ] = `${ siteUrl }/graphql`;
	}
	if ( input.applicationUser && input.applicationPassword ) {
		env[ FRONTEND_ENV.WORDPRESS_APPLICATION_USER ] = input.applicationUser;
		env[ FRONTEND_ENV.WORDPRESS_APPLICATION_PASSWORD ] = input.applicationPassword;
	}
	if ( input.frontend.previewSecret ) {
		env[ FRONTEND_ENV.STUDIO_PREVIEW_SECRET ] = input.frontend.previewSecret;
	}
	if ( input.frontend.revalidateSecret ) {
		env[ FRONTEND_ENV.STUDIO_REVALIDATE_SECRET ] = input.frontend.revalidateSecret;
	}
	return env;
}

// Serializes env for a dotenv file. Values are double-quoted so spaces and `#`
// survive; dotenv parsers unescape `\"` and `\\`.
export function formatEnvFile( env: Record< string, string > ): string {
	return (
		Object.entries( env )
			.map( ( [ key, value ] ) => {
				const escaped = value.replace( /\\/g, '\\\\' ).replace( /"/g, '\\"' );
				return `${ key }="${ escaped }"`;
			} )
			.join( '\n' ) + '\n'
	);
}
