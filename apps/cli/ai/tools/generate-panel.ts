import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import { emitEvent } from 'cli/ai/json-events';
import { runCommand as runStartSiteCommand } from 'cli/commands/site/start';
import { disconnectFromDaemon } from 'cli/lib/daemon-client';
import { generateAndDeployScratchPanel } from 'cli/lib/studio-panels-builder';
import { isServerRunning, sendWpCliCommand } from 'cli/lib/wordpress-server-manager';
import { errorResult, resolveSite, textResult } from './utils';

const PLUGIN_BASENAME = 'studio-panels/studio-panels.php';
const GUTENBERG_BASENAME = 'gutenberg/gutenberg.php';
const SCRATCH_DEEP_LINK = '/scratch';
const PANEL_PAGE_SLUG = 'studio-panels-wp-admin';

// Cheap structural checks so the agent gets a fixable error before paying
// for a wp-build round-trip on broken source.
export function validateScratchSource(
	source: string
): { ok: true } | { ok: false; errors: string[] } {
	const errors: string[] = [];

	if ( ! source || source.trim().length === 0 ) {
		return { ok: false, errors: [ 'Source is empty.' ] };
	}

	if (
		! /\bexport\s+(?:function|const|let|var)\s+stage\b/.test( source ) &&
		! /\bexport\s*\{\s*[^}]*\bstage\b[^}]*\}/.test( source )
	) {
		errors.push(
			'Source must export a `stage` value (wp-build route convention). ' +
				'Example: `export const stage = () => <div>…</div>;`'
		);
	}

	const importLines = source.match( /^\s*import\b.*$/gm ) ?? [];
	for ( const line of importLines ) {
		const fromMatch = line.match( /from\s+['"]([^'"]+)['"]/ );
		if ( ! fromMatch ) continue;
		const spec = fromMatch[ 1 ];
		if ( ! spec.startsWith( '@wordpress/' ) ) {
			errors.push(
				`Disallowed import: \`${ spec }\`. Only \`@wordpress/*\` packages are externalized; ` +
					`anything else won't resolve at runtime.`
			);
		}
	}

	return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

async function ensureSiteRunningAndPluginActive( site: {
	id: string;
	path: string;
} ): Promise< void > {
	if ( ! ( await isServerRunning( site.id ) ) ) {
		await runStartSiteCommand( site.path, /* skipBrowser */ true, /* skipLogDetails */ true );
	}
	try {
		await sendWpCliCommand( site.id, [
			'plugin',
			'install',
			'gutenberg',
			'--activate',
			'--quiet',
		] );
	} catch {
		// Non-fatal — surfaced as an admin notice in the panel page if Gutenberg is truly absent.
	}
	try {
		await sendWpCliCommand( site.id, [
			'plugin',
			'activate',
			PLUGIN_BASENAME,
			GUTENBERG_BASENAME,
		] );
	} catch {
		// Non-fatal — manual activation still works.
	}
}

export const generatePanelTool = tool(
	'studio_generate_panel',
	'Generates a custom React panel rendered in the Studio site preview pane. This is the way ' +
		'to fulfil any "show me / list / display / edit" request involving the user\'s WordPress ' +
		'data — list of posts/pages/comments/users/CPTs, edit forms, settings screens, ' +
		'dashboards, anything else. Write a complete TSX module exporting a `stage` value ' +
		'(wp-build route convention); Studio bundles it via @wordpress/build (~200ms) and renders ' +
		'it inside the studio-panels wp-admin page.\n\n' +
		'CONVENTIONS — follow these so panels stay consistent and idiomatic:\n' +
		'1. LISTING entities (posts, pages, comments, users, CPTs, terms): use <DataViews> from ' +
		'@wordpress/dataviews. Drive it with `useSelect` + `getEntityRecords` from ' +
		'@wordpress/core-data. Define `fields` and a `view` state, wire `onChangeView` so the ' +
		'user can sort/filter/paginate.\n' +
		'2. FORMS (settings, single-record edit): use <DataForm> from @wordpress/dataviews. Read ' +
		'the record with `getEntityRecord` and save via `dispatch(coreStore).saveEntityRecord` / ' +
		'`saveEditedEntityRecord`. For site settings, the entity is `("root", "site")`.\n' +
		'3. DASHBOARDS / multi-source / bespoke layouts: compose @wordpress/components (Card, ' +
		'CardBody, Flex, FlexItem, Notice, Button) with the same core-data fetching pattern.\n' +
		'4. CLIENT↔SERVER COMMUNICATION: always go through @wordpress/core-data ' +
		'(useSelect + getEntityRecord(s) for reads, dispatch + saveEntityRecord for writes). Do ' +
		'NOT call `apiFetch` directly unless the data is genuinely outside the entity model.\n' +
		'5. NEED DATA NOT IN CORE REST? Extend the API: write a small mu-plugin at ' +
		'`<sitePath>/wp-content/mu-plugins/studio-extend.php` that registers your endpoint via ' +
		'`register_rest_route` (or registers a custom post type with `show_in_rest: true`). ' +
		'Then the panel can read it via `getEntityRecords` against the new route.\n' +
		'6. IMPORTS must come from `@wordpress/*` only (externalized to `wp.*` globals). No ' +
		'lodash, axios, react-query, etc. Use `useState/useEffect/useMemo` from ' +
		'@wordpress/element and `__()` from @wordpress/i18n for translatable strings.',
	{
		nameOrPath: z
			.string()
			.describe( 'The site name or file system path of the local site to render the panel into.' ),
		source: z
			.string()
			.min( 1 )
			.describe(
				'Complete TSX source for the panel. Must export a `stage` value: ' +
					'`export const stage = () => <div>…</div>;`. Imports must come from `@wordpress/*` ' +
					'packages only.'
			),
		summary: z
			.string()
			.optional()
			.describe(
				'Optional one-line description of what the panel does, included in the response.'
			),
	},
	async ( args ) => {
		const validation = validateScratchSource( args.source );
		if ( ! validation.ok ) {
			return errorResult( 'Source validation failed:\n - ' + validation.errors.join( '\n - ' ) );
		}

		try {
			const site = await resolveSite( args.nameOrPath );
			const result = await generateAndDeployScratchPanel( {
				source: args.source,
				sitePath: site.path,
			} );
			try {
				await ensureSiteRunningAndPluginActive( site );

				const url = `/wp-admin/admin.php?page=${ PANEL_PAGE_SLUG }&p=${ encodeURIComponent(
					SCRATCH_DEEP_LINK
				) }`;
				const navigatePath = `/studio-auto-login?redirect_to=${ encodeURIComponent( url ) }`;
				emitEvent( {
					type: 'preview.command',
					timestamp: new Date().toISOString(),
					kind: 'navigate',
					path: navigatePath,
				} );

				const summary = args.summary ? ` — ${ args.summary }` : '';
				return textResult(
					`Generated scratch panel${ summary } and deployed to ${ site.name } in ${ result.durationMs }ms (v${ result.bumpedVersion }).`
				);
			} finally {
				// Daemon bus stays open after `sendWpCliCommand`; close it so
				// the agent child can exit and the UI's `winding_down` phase ends.
				await disconnectFromDaemon().catch( () => undefined );
			}
		} catch ( error ) {
			return errorResult(
				`Failed to generate panel: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
