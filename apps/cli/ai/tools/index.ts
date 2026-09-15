import { emitChatArtifactWidgets } from 'cli/ai/chat-artifacts';
import { createPreviewTool } from './create-preview';
import { createSiteTool } from './create-site';
import { dataLiberationTool } from './data-liberation';
import { deletePreviewTool } from './delete-preview';
import { deleteSiteTool } from './delete-site';
import { exportSiteTool } from './export-site';
import { generateImagesTool } from './generate-images';
import { importSiteTool } from './import-site';
import { inspectDesignTool } from './inspect-design';
import { installTaxonomyScriptsTool } from './install-taxonomy-scripts';
import { listConnectedRemoteSitesTool } from './list-connected-remote-sites';
import { listPreviewsTool } from './list-previews';
import { listSitesTool } from './list-sites';
import { auditPerformanceTool } from './need-for-speed';
import { openAnnotationBrowserTool } from './open-annotation-browser';
import { createPickDesignTool, pickDesignTool } from './pick-design';
import { pullSiteTool } from './pull-site';
import { pushSiteTool } from './push-site';
import { auditSeoTool } from './rank-me-up';
import { refreshBrowserTool } from './refresh-browser';
import { scaffoldThemeTool } from './scaffold-theme';
import { getSiteInfoTool } from './site-info';
import { startSiteTool } from './start-site';
import { stopSiteTool } from './stop-site';
import { studioPresentTool } from './studio-present';
import { createTakeScreenshotTool, takeScreenshotTool } from './take-screenshot';
import { updatePreviewTool } from './update-preview';
import { validateBlocksTool } from './validate-blocks';
import { waitForAnnotationsTool } from './wait-for-annotations';
import { runWpCliTool } from './wp-cli';
import type { AnyStudioAgentTool, StudioToolResultDetails } from './define-tool';
import type { DesignTracksContext } from 'cli/ai/design-tracks';

export { captureCommandOutput } from './utils';

// The one-line snippet each tool contributes to the system prompt's tool list
// (the text the prompt used to hand-write), keyed by tool name. Text-only
// models get the variant that does not assume the model can view a capture.
const TOOL_PROMPTS: Record< string, { snippet: string; textOnlySnippet?: string } > = {
	site_create: {
		snippet: 'Create a new WordPress site (name only — handles everything automatically)',
	},
	site_list: {
		snippet: 'List all local WordPress sites with their status',
	},
	site_info: {
		snippet: 'Get details about a specific site (path, URL, credentials, running status)',
	},
	site_start: {
		snippet: 'Start a stopped site',
	},
	site_stop: {
		snippet: 'Stop a running site',
	},
	site_delete: {
		snippet: 'Delete a site from Studio and optionally move its files to trash',
	},
	preview_create: {
		snippet:
			'Create a preview site (a temporary, expiring hosted preview) for a local site; when a local site is selected, preview that site instead of creating a new local site; requires WordPress.com authentication and can take a few minutes, so tell the user to wait',
	},
	preview_list: {
		snippet:
			'List preview sites (temporary, expiring hosted previews) for a local site. These are NOT connected WordPress.com remote sites.',
	},
	preview_update: {
		snippet:
			'Update an existing preview site from a local site; this can take a few minutes, so tell the user to wait',
	},
	preview_delete: {
		snippet: 'Delete a preview site by hostname',
	},
	wp_cli: {
		snippet: 'Run WP-CLI commands on a running site',
	},
	refresh_browser: {
		snippet:
			'Reload the in-app site preview so the user sees your latest changes. Reloads in place; never stop/start the site to refresh the preview.',
	},
	scaffold_theme: {
		snippet:
			"Scaffold a minimal block theme (style.css, theme.json, functions.php with frontend + editor enqueue, default templates and parts, empty assets/fonts and patterns dirs) into a site and activate it. Use as the first step when starting a new custom theme; the agent fills design-specific content afterwards. Pass parentTheme with an installed theme's slug to scaffold a child theme instead of editing that theme's files. Block themes only.",
	},
	validate_blocks: {
		snippet:
			"Validate block content in two stages and return a combined report. First a static core/html policy check; if it finds invalid core/html blocks it returns only those (rewrite them as editable core or plugin blocks and call again) and skips the editor. Once it passes, validates in the running site's real block editor: with filePath, applies safe editor fixes directly to the file and returns a CSS-review diff; with inline content, returns exact fixed block content plus the diff. Requires a site name or path. Call after every file write/edit that contains block content.",
	},
	take_screenshot: {
		snippet:
			'Take a full-page screenshot of a URL (supports desktop, mobile, or `viewport: "all"` for both). Use this to visually check the site after building it.',
		textOnlySnippet:
			'Save a full-page screenshot of a URL to a file (supports desktop, mobile, or `viewport: "all"` for both). You cannot view the image; the result reports the saved file path, which you need for the theme screenshot.',
	},
	inspect_design: {
		snippet:
			'Inspect the rendered DOM and computed styles of a page by CSS selector to root-cause visual issues. Pair with take_screenshot when verifying or polishing a design.',
		textOnlySnippet:
			'Inspect the rendered DOM and computed styles of a page by CSS selector. This is your verification tool: read widths, positions, and padding from it instead of looking at a capture.',
	},
	generate_images: {
		snippet:
			'Generate AI images (JPEG) from text specs and write them to files inside a site. Batch all the images a page needs into one call. Load the `imagery` skill first for spec-writing rules and file placement.',
	},
	need_for_speed: {
		snippet:
			'Measure frontend performance metrics (TTFB, FCP, LCP, CLS, page weight, DOM size, JS/CSS/image/font asset breakdown) for a running site. Use this to identify performance bottlenecks and guide optimization.',
	},
	rank_me_up: {
		snippet:
			'Run an on-page SEO audit (title/meta tags, headings, image alt text, OpenGraph/Twitter cards, JSON-LD structured data, robots.txt and sitemap.xml availability) for a running site. Use this to identify on-page SEO issues and guide fixes.',
	},
	site_connected_remote_sites: {
		snippet:
			'List the durable WordPress.com remote sites (production/staging) already attached to a local site for syncing. These are distinct from temporary preview sites (preview_list). Call this before site_push to decide how to ask the user which remote site to target.',
	},
	site_push: {
		snippet:
			'Push a local site to a WordPress.com site. Requires authentication (studio auth login). Specify the remote site URL or ID and sync options (all, sqls, uploads, plugins, themes, contents).',
	},
	site_pull: {
		snippet:
			'Pull a WordPress.com site to a local site. Requires authentication. Specify the remote site URL or ID and sync options.',
	},
	site_import: {
		snippet:
			'Import a backup file (.zip, .tar.gz, .sql, .wpress, .xml WordPress export) into a local site.',
	},
	site_export: {
		snippet:
			'Export a local site to a backup file. Supports full-site (.zip, .tar.gz) or database-only (.sql) exports.',
	},
	studio_present: {
		snippet: 'Show one or more Studio desks widgets as inline visual artifacts.',
	},
};

function withPromptSnippet( tool: AnyStudioAgentTool, visionEnabled: boolean ): AnyStudioAgentTool {
	const prompt = TOOL_PROMPTS[ tool.name ];
	if ( ! prompt ) {
		return tool;
	}
	const promptSnippet =
		! visionEnabled && prompt.textOnlySnippet ? prompt.textOnlySnippet : prompt.snippet;
	return { ...tool, promptSnippet };
}

export const studioToolDefinitions: AnyStudioAgentTool[] = [
	createSiteTool,
	listSitesTool,
	getSiteInfoTool,
	startSiteTool,
	stopSiteTool,
	deleteSiteTool,
	createPreviewTool,
	listPreviewsTool,
	updatePreviewTool,
	deletePreviewTool,
	runWpCliTool,
	refreshBrowserTool,
	scaffoldThemeTool,
	pickDesignTool,
	validateBlocksTool,
	takeScreenshotTool,
	inspectDesignTool,
	generateImagesTool,
	installTaxonomyScriptsTool,
	dataLiberationTool,
	auditPerformanceTool,
	auditSeoTool,
	listConnectedRemoteSitesTool,
	pushSiteTool,
	pullSiteTool,
	importSiteTool,
	exportSiteTool,
	openAnnotationBrowserTool,
	waitForAnnotationsTool,
];

export interface CreateStudioToolsOptions {
	// Enable automatic chat artifact emission from tool results. Desktop agent
	// runs set this; standalone CLI/MCP runs leave it off so visual artifacts are
	// ignored instead of leaking into terminal transcripts.
	emitChatArtifacts?: boolean;
	// Enable generate_images. Callers resolve isImageGenerationAvailable()
	// (async) and pass it; when off, sessions behave exactly as before the tool
	// existed (no tool, no imagery prompt sections).
	imageGeneration?: boolean;
	// False for models that cannot view images. Defaults to true.
	visionEnabled?: boolean;
	// Lets pick_design offer options to pick from. Defaults to false.
	canAskUser?: boolean;
	// The chat session the design tools record Tracks events for; absent for the MCP server.
	tracks?: DesignTracksContext;
}

export function resolveStudioToolDefinitions(
	options: CreateStudioToolsOptions = {}
): AnyStudioAgentTool[] {
	const definitions =
		options.emitChatArtifacts === true
			? [ ...studioToolDefinitions, studioPresentTool ]
			: studioToolDefinitions;

	return definitions.flatMap( ( candidate ) => {
		// refresh_browser only makes sense when a Studio UI with a preview pane
		// is attached to consume the preview.reload event; emitChatArtifacts is
		// the existing "UI attached" signal (process.send available).
		if ( candidate.name === refreshBrowserTool.name && options.emitChatArtifacts !== true ) {
			return [];
		}
		if ( candidate.name === generateImagesTool.name && ! options.imageGeneration ) {
			return [];
		}
		let tool = candidate;
		if ( candidate.name === takeScreenshotTool.name && options.visionEnabled === false ) {
			tool = createTakeScreenshotTool( { visionEnabled: false } );
		}
		if ( candidate.name === pickDesignTool.name && ( options.canAskUser || options.tracks ) ) {
			tool = createPickDesignTool( {
				canAskUser: options.canAskUser === true,
				tracks: options.tracks,
			} );
		}
		return [
			withChatArtifactEmission(
				withPromptSnippet( tool, options.visionEnabled !== false ),
				options.emitChatArtifacts === true
			),
		];
	} );
}

export function withChatArtifactEmission< TTool extends AnyStudioAgentTool >(
	tool: TTool,
	emitChatArtifacts: boolean
): TTool {
	if ( ! emitChatArtifacts ) {
		return tool;
	}
	return {
		...tool,
		execute: async ( toolCallId, params, signal, onUpdate ) => {
			const result = await tool.execute( toolCallId, params, signal, onUpdate );
			const details = result.details as StudioToolResultDetails | undefined;
			try {
				await emitChatArtifactWidgets( details?.studioArtifacts );
			} catch ( error ) {
				// Artifacts are presentation-only; a failed emit (e.g. session file
				// unwritable) must never turn a successful tool result into an error.
				console.warn( `[chat-artifacts] failed to emit artifact for ${ tool.name }:`, error );
			}
			return result;
		},
	};
}
