import { z } from 'zod';
import { siteDetailsSchema } from '@studio/common/lib/cli-events';
import { captureException } from '@studio/common/lib/error-reporting';
import { siteOperationSchema } from '@studio/common/lib/site-operation';
import { snapshotSchema } from '@studio/common/types/snapshot';

/**
 * The shape of `~/.studio/config.json`. Each top-level key is a section, parsed on its own so a
 * broken section can't take the others down (see `./store.ts`). Sections are loose: a build that
 * rewrites one keeps the fields a newer build added, so adding a field needs no version bump.
 */

// Bump only when existing data changes shape, with a step in `./migrations.ts`.
export const CONFIG_VERSION = 2;

const optional = < T extends z.ZodType >( schema: T ) => schema.optional().catch( undefined );

const reported = new Set< string >();

// Every read parses the file again, so each problem is reported once per process.
export function reportOnce( message: string ): void {
	if ( ! reported.has( message ) ) {
		reported.add( message );
		captureException( new Error( message ) );
	}
}

// Leaves out the entries that don't parse instead of failing the whole list. The store writes
// them back as they were, so a newer or damaged entry is never lost.
function tolerantArray< T extends z.ZodType >( item: T ) {
	return z.array( z.unknown() ).transform( ( entries ) =>
		entries.flatMap( ( entry ) => {
			const parsed = item.safeParse( entry );
			if ( ! parsed.success ) {
				reportOnce( `Ignored an invalid config entry: ${ parsed.error.message }` );
				return [];
			}
			return [ parsed.data as z.output< T > ];
		} )
	);
}

const installSchema = z.looseObject( {
	// Anonymous Tracks install id. See `docs/design-docs/analytics-tracks.md`.
	analyticsId: optional( z.string() ),
	sentryUserId: optional( z.string() ),
	// The stable id providers' sign-ins name this computer with.
	signInHostId: optional( z.string() ),
} );

const providersSchema = z.looseObject( {
	// The AI provider Studio Code runs on. A plain string so a provider a newer build added
	// degrades gracefully; readers go through `normalizeProviderId`.
	selected: optional( z.string() ),
	// The provider picked for image generation; absent picks it automatically.
	selectedImage: optional( z.string() ),
	// Each provider's config, checked against its provider's schema in `../provider-config.ts`.
	configs: z.record( z.string(), z.unknown() ).catch( {} ).default( {} ),
	// What each provider kept when it rejected its config (its descriptor's `remember`).
	remembered: z.record( z.string(), z.record( z.string(), z.string() ) ).catch( {} ).default( {} ),
} );

// Read field by field in `../user-settings/user-preferences.ts`, which falls back to each default.
const preferencesSchema = z.looseObject( {
	locale: optional( z.string() ),
	analyticsOptOut: optional( z.boolean() ),
	selectedSkills: optional( z.array( z.string() ) ),
	// False when the user switched their global agent instructions off.
	globalInstructionsEnabled: optional( z.boolean() ),
	onboardingCompleted: optional( z.boolean() ),
	onboardingHints: optional( z.record( z.string(), z.unknown() ) ),
} );

export const siteConnectionSchema = z.looseObject( {
	preview: z.literal( true ).optional(),
	provider: z.string(),
	// The account the connection belongs to, for providers whose sites depend on the signed-in
	// account (the WordPress.com user id).
	account: z.string().optional(),
	site: z.record( z.string(), z.unknown() ),
	lastPushTimestamp: z.string().nullable().default( null ),
	lastPullTimestamp: z.string().nullable().default( null ),
	localVersionId: z.string().nullable().optional(),
} );

export type SiteConnection = z.infer< typeof siteConnectionSchema >;

/**
 * Health of a site's local install.
 *
 *   - `ready`        a normal, fully-written site (the default).
 *   - `pulling`      a reprint pull is in flight, or was interrupted mid-flight: the site
 *                    directory may be partially written and must not be trusted.
 *   - `pull-failed`  the last reprint pull errored or was killed; recovered by re-running
 *                    `pull --path <site>` or `site delete`.
 */
const siteStatusSchema = z.enum( [ 'ready', 'pulling', 'pull-failed' ] );

export const configSiteSchema = siteDetailsSchema
	.omit( { emailPath: true, phpMyAdminSupported: true } )
	.extend( {
		url: z.string().optional(),
		tracksId: z.string().optional(),
		latestCliPid: z.number().optional(),
		// True once a full reprint pull has completed at least once.
		importComplete: z.boolean().optional(),
		status: siteStatusSchema.default( 'ready' ).optional(),
		// The in-flight Studio operation holding this site. Transient, unlike `status`: once its
		// owning process is gone it's reclaimed on the next acquire. See `cli/lib/site-operations`.
		operation: siteOperationSchema.optional(),
		sortOrder: optional( z.number() ),
		autoStart: optional( z.boolean() ),
		hideFrontendAdminBar: optional( z.boolean() ),
		connections: z.array( siteConnectionSchema ).catch( [] ).optional(),
		// The day's runtime adoption stat, so it's bumped once a day per site.
		runtimeStat: optional( z.object( { bumpedAt: z.number(), stat: z.string() } ) ),
	} )
	.loose();

export type ConfigSite = z.infer< typeof configSiteSchema >;

const sessionPlacementSchema = z.object( {
	kind: z.literal( 'site' ),
	siteId: z.string(),
	sitePath: z.string(),
	siteName: z.string(),
} );

export type SessionPlacement = z.infer< typeof sessionPlacementSchema >;

const configSessionSchema = z.looseObject( {
	archived: optional( z.boolean() ),
	// A name the user gave the chat, in place of its first prompt.
	title: optional( z.string() ),
	// A turn finished that nobody has looked at yet.
	unread: optional( z.boolean() ),
	// The local site the session created or works on.
	placement: optional( sessionPlacementSchema ),
} );

export type ConfigSession = z.infer< typeof configSessionSchema >;

const updateCheckSchema = z.object( { lastChecked: z.number(), latestVersion: z.string() } );

const statsSchema = z.looseObject( {
	// When each stat was last bumped, by stat group, so a daily or weekly stat is bumped once.
	lastBump: z.record( z.string(), z.record( z.string(), z.number() ) ).catch( {} ).default( {} ),
} );

const windowBoundsSchema = z.object( {
	x: z.number(),
	y: z.number(),
	width: z.number(),
	height: z.number(),
	isFullScreen: z.boolean().optional(),
} );

export type WindowBounds = z.infer< typeof windowBoundsSchema >;

const promptResultSchema = z.object( {
	response: z.enum( [ 'yes', 'no' ] ),
	dontAskAgain: z.boolean(),
} );

// State only the Desktop app reads.
const desktopSchema = z.looseObject( {
	windowBounds: optional( windowBoundsSchema ),
	devToolsOpen: optional( z.boolean() ),
	wapuuScore: optional( z.number() ),
	lastNightlyUpdateCheck: optional( z.number() ),
	nightlyPromptResult: optional( promptResultSchema ),
	promptWindowsSpeedUpResult: optional( promptResultSchema.extend( { appVersion: z.string() } ) ),
	dontShowArm64Warning: optional( z.boolean() ),
	// The user removed the `studio` command, so Studio doesn't install it again.
	cliUserUninstalled: optional( z.boolean() ),
} );

// State only the CLI reads.
const cliSchema = z.looseObject( {
	updateCheck: optional( updateCheckSchema ),
	// Same as `updateCheck`, for standalone installs that check the CDN endpoint.
	standaloneUpdateCheck: optional( updateCheckSchema ),
	lastDependencyCheckTime: optional( z.number() ),
	// When the one-time Terms of Service notice was shown (ms).
	tosNoticeShownAt: optional( z.number() ),
} );

// The sections that are lists, by the schema of an entry.
export const CONFIG_LISTS = {
	sites: configSiteSchema,
	snapshots: snapshotSchema.loose(),
};

export const CONFIG_SECTIONS = {
	install: installSchema.catch( {} ),
	providers: providersSchema,
	preferences: preferencesSchema,
	sites: tolerantArray( CONFIG_LISTS.sites ),
	snapshots: tolerantArray( CONFIG_LISTS.snapshots ),
	sessions: z.record( z.string(), configSessionSchema ),
	stats: statsSchema,
	desktop: desktopSchema,
	cli: cliSchema,
};

export type ConfigSectionName = keyof typeof CONFIG_SECTIONS;

export type Config = {
	[ Section in ConfigSectionName ]: z.output< ( typeof CONFIG_SECTIONS )[ Section ] >;
};

export const EMPTY_SECTIONS: { [ Section in ConfigSectionName ]: unknown } = {
	install: {},
	providers: {},
	preferences: {},
	sites: [],
	snapshots: [],
	sessions: {},
	stats: {},
	desktop: {},
	cli: {},
};
