import { tool } from '@anthropic-ai/claude-agent-sdk';
import { emitEvent } from 'cli/ai/json-events';
import { runCommand as runStartSiteCommand } from 'cli/commands/site/start';
import { disconnectFromDaemon } from 'cli/lib/daemon-client';
import { ensureStudioPanelsInstalled } from 'cli/lib/studio-panels-installer';
import { isServerRunning, sendWpCliCommand } from 'cli/lib/wordpress-server-manager';
import { z } from 'zod/v4';
import { errorResult, resolveSite, textResult } from './utils';

const PLUGIN_BASENAME = 'studio-panels/studio-panels.php';
const GUTENBERG_BASENAME = 'gutenberg/gutenberg.php';
const PANEL_PAGE_SLUG = 'studio-panels-wp-admin';
const MAX_PER_PAGE = 100;

/**
 * Ensure the site is running, Gutenberg is installed (Studio Panels needs the
 * `@wordpress/boot`, `@wordpress/route`, and `@wordpress/dataviews` script
 * modules that ship with Gutenberg / WP 7.0+), and the panels plugin itself
 * is active. All steps are idempotent and silent on the happy path so calling
 * this on every panel request is cheap.
 *
 * Bundling these into the panel tool means the agent only has to make one
 * tool call instead of `site_start` → `wp_cli plugin install` →
 * `studio_show_panel` (three LLM round-trips).
 */
async function ensureSiteRunningAndPluginActive( site: {
	id: string;
	path: string;
} ): Promise< void > {
	if ( ! ( await isServerRunning( site.id ) ) ) {
		await runStartSiteCommand( site.path, /* skipBrowser */ true, /* skipLogDetails */ true );
	}

	// Install Gutenberg if missing. `plugin install --activate` is a no-op
	// when the plugin is already installed and active.
	try {
		await sendWpCliCommand( site.id, [
			'plugin',
			'install',
			'gutenberg',
			'--activate',
			'--quiet',
		] );
	} catch {
		// Non-fatal — the user may already have Gutenberg or be offline.
	}

	try {
		await sendWpCliCommand( site.id, [
			'plugin',
			'activate',
			PLUGIN_BASENAME,
			GUTENBERG_BASENAME,
		] );
	} catch {
		// Activation failures are non-fatal — the plugin files are on disk
		// and the user can activate from wp-admin if needed.
	}
}

/**
 * Discriminated union of panel intents the agent can request.
 *
 * v1 ships only the `list` kind. New kinds (`edit`, `form`, `settings`,
 * `custom`) become new branches here without changing the tool surface or
 * the URL composer's contract.
 */
export type PanelIntent = {
	kind: 'list';
	postType: string;
	columns?: string[];
	search?: string;
	perPage?: number;
};

export type ComposedPanelUrl = { ok: true; url: string } | { ok: false; error: string };

/**
 * Compose the wp-admin URL the preview should navigate to in order to render
 * the requested panel. Pure function: no IO, easy to unit-test.
 */
export function composePanelUrl( intent: PanelIntent ): ComposedPanelUrl {
	if ( intent.kind === 'list' ) {
		const postType = intent.postType?.trim();
		if ( ! postType ) {
			return { ok: false, error: '`postType` is required for list panels.' };
		}

		const params = new URLSearchParams();
		params.set( 'postType', postType );

		if ( intent.columns && intent.columns.length > 0 ) {
			params.set( 'columns', intent.columns.join( ',' ) );
		}
		if ( intent.search ) {
			params.set( 'search', intent.search );
		}
		if ( intent.perPage !== undefined ) {
			if ( ! Number.isInteger( intent.perPage ) || intent.perPage < 1 ) {
				return { ok: false, error: '`perPage` must be a positive integer.' };
			}
			const clamped = Math.min( intent.perPage, MAX_PER_PAGE );
			params.set( 'perPage', String( clamped ) );
		}

		const deepLink = `/list?${ params.toString() }`;
		const url = `/wp-admin/admin.php?page=${ PANEL_PAGE_SLUG }&p=${ encodeURIComponent(
			deepLink
		) }`;
		return { ok: true, url };
	}

	// Exhaustiveness guard: extending the union forces a new branch above.
	const _exhaustive: never = intent.kind;
	return { ok: false, error: `Unknown panel kind: ${ String( _exhaustive ) }` };
}

const showPanelSchema = {
	nameOrPath: z
		.string()
		.describe( 'The site name or file system path of the local site to render the panel into.' ),
	kind: z
		.literal( 'list' )
		.describe(
			'The kind of panel to render. v1 supports "list" only. Future kinds: edit, form, settings.'
		),
	postType: z
		.string()
		.default( 'post' )
		.describe(
			'WordPress post type slug to list (e.g. "post", "page", or a custom post type). Defaults to "post".'
		),
	columns: z
		.array( z.string() )
		.optional()
		.describe(
			'Columns to display. Defaults to ["title", "date", "status"]. Available: title, date, status, id, type, author.'
		),
	search: z
		.string()
		.optional()
		.describe( 'Optional search query passed to the WordPress REST search.' ),
	perPage: z
		.number()
		.int()
		.min( 1 )
		.max( MAX_PER_PAGE )
		.optional()
		.describe( `Number of items per page. Defaults to 20, clamped to ${ MAX_PER_PAGE } maximum.` ),
};

export const showPanelTool = tool(
	'studio_show_panel',
	'Renders a parameterized panel in the Studio site preview pane. Currently supports ' +
		'`kind: "list"` for any WordPress post type. Pick `postType`, `columns`, `perPage`, and ' +
		"`search` from the user's wording.",
	showPanelSchema,
	async ( args ) => {
		const intent: PanelIntent = {
			kind: args.kind,
			postType: args.postType,
			columns: args.columns,
			search: args.search,
			perPage: args.perPage,
		};

		const composed = composePanelUrl( intent );
		if ( ! composed.ok ) {
			return errorResult( composed.error );
		}

		try {
			const site = await resolveSite( args.nameOrPath );
			const result = await ensureStudioPanelsInstalled( site.path );
			try {
				await ensureSiteRunningAndPluginActive( site );

				// Panels live behind wp-admin auth. Wrap the destination with the
				// `/studio-auto-login` mu-plugin endpoint so the preview iframe
				// gets an admin cookie before landing on the panel page.
				const navigatePath = `/studio-auto-login?redirect_to=${ encodeURIComponent(
					composed.url
				) }`;

				emitEvent( {
					type: 'preview.command',
					timestamp: new Date().toISOString(),
					kind: 'navigate',
					path: navigatePath,
				} );

				const installNote = result.installed
					? result.previousVersion
						? ` Updated Studio Panels plugin from v${ result.previousVersion } to v${ result.currentVersion }.`
						: ` Installed Studio Panels plugin v${ result.currentVersion }.`
					: '';

				return textResult(
					`Showing ${ args.kind } panel for "${ args.postType }" on ${ site.name }.${ installNote }`
				);
			} finally {
				// `sendWpCliCommand` opens a daemon bus connection that keeps
				// the agent child's event loop alive. Disconnect explicitly so
				// the child can exit after the turn — otherwise `run.exited`
				// never fires and the UI's `winding_down` phase persists.
				await disconnectFromDaemon().catch( () => undefined );
			}
		} catch ( error ) {
			return errorResult(
				`Failed to show panel: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
