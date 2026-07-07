import { createCheckpoint, isCheckpointSupported } from 'cli/lib/checkpoints/create';
import { readCheckpointIndex, type CheckpointManifest } from 'cli/lib/checkpoints/manifest';
import { checkpointArtifact } from './checkpoints';
import { resolveSite } from './utils';
import type { AnyStudioAgentTool, StudioToolResultDetails, ToolResult } from './define-tool';

// Skip the auto-checkpoint when the site's newest checkpoint (of any kind) is
// younger than this: a burst of wp_cli calls is one logical operation and
// shouldn't stack a checkpoint per call. The trade-off: restoring during a
// burst rolls back the whole burst, not just the last tool.
export const AUTO_CHECKPOINT_DEBOUNCE_MS = 2 * 60 * 1000;

type SiteRefExtractor = ( params: Record< string, unknown > ) => string | undefined;

// Tools that mutate site state get a checkpoint captured before they run.
// Each entry extracts the site name/path from that tool's own params.
// Not listed: checkpoint_restore (takes its own pre-restore checkpoint),
// site_delete (the store is deleted with the site), push/preview tools
// (remote-side effects only), and read-only tools.
const nameOrPath: SiteRefExtractor = ( params ) =>
	typeof params.nameOrPath === 'string' ? params.nameOrPath : undefined;

const AUTO_CHECKPOINT_TOOLS: Record< string, SiteRefExtractor > = {
	wp_cli: nameOrPath,
	site_import: nameOrPath,
	site_pull: nameOrPath,
	scaffold_theme: nameOrPath,
	install_taxonomy_scripts: nameOrPath,
	// Data Liberation site-targeting tools receive a Studio target inside the
	// forwarded engine args: { kind: 'studio', sitePath: '…' }.
	data_liberation: ( params ) => {
		const args = params.args;
		if ( args && typeof args === 'object' ) {
			const target = ( args as Record< string, unknown > ).target;
			if ( target && typeof target === 'object' ) {
				const sitePath = ( target as Record< string, unknown > ).sitePath;
				if ( typeof sitePath === 'string' ) {
					return sitePath;
				}
			}
			const sitePath = ( args as Record< string, unknown > ).sitePath;
			if ( typeof sitePath === 'string' ) {
				return sitePath;
			}
		}
		return undefined;
	},
};

// Captures a checkpoint before a destructive tool runs. Never throws — a
// checkpoint failure must not block the tool — and returns the manifest only
// when a checkpoint was actually created (not when debounced), so chat chips
// never imply a fresh capture that didn't happen.
async function maybeCreateAutoCheckpoint(
	toolName: string,
	siteRef: string | undefined
): Promise< CheckpointManifest | undefined > {
	if ( ! siteRef ) {
		return undefined;
	}
	try {
		const site = await resolveSite( siteRef );
		if ( ! isCheckpointSupported( site ) ) {
			return undefined;
		}

		const index = await readCheckpointIndex( site.id );
		const newest = index.checkpoints[ index.checkpoints.length - 1 ];
		if ( newest && Date.now() - newest.createdAt < AUTO_CHECKPOINT_DEBOUNCE_MS ) {
			return undefined;
		}

		return await createCheckpoint( site, {
			trigger: 'auto-pre-tool',
			toolName,
		} );
	} catch ( error ) {
		console.warn(
			`[checkpoints] auto-checkpoint before ${ toolName } failed:`,
			error instanceof Error ? error.message : error
		);
		return undefined;
	}
}

function withCheckpointArtifact( result: ToolResult, manifest: CheckpointManifest ): ToolResult {
	return {
		...result,
		studioArtifacts: [ checkpointArtifact( manifest ), ...( result.studioArtifacts ?? [] ) ],
	};
}

// Wraps a destructive tool so a checkpoint is captured before it executes.
// Both entry points are wrapped: `rawHandler` (MCP dispatch) and `execute`
// (the pi agent loop) — they don't share a code path.
export function withAutoCheckpoint< TTool extends AnyStudioAgentTool >( tool: TTool ): TTool {
	const extractSiteRef = AUTO_CHECKPOINT_TOOLS[ tool.name ];
	if ( ! extractSiteRef ) {
		return tool;
	}

	return {
		...tool,
		rawHandler: async ( params: never ) => {
			const manifest = await maybeCreateAutoCheckpoint(
				tool.name,
				extractSiteRef( params as Record< string, unknown > )
			);
			const result = await tool.rawHandler( params );
			return manifest ? withCheckpointArtifact( result, manifest ) : result;
		},
		execute: async ( toolCallId, params, signal, onUpdate ) => {
			const manifest = await maybeCreateAutoCheckpoint(
				tool.name,
				extractSiteRef( params as Record< string, unknown > )
			);
			const result = await tool.execute( toolCallId, params, signal, onUpdate );
			if ( ! manifest ) {
				return result;
			}
			const details = ( result.details ?? {} ) as StudioToolResultDetails;
			return {
				...result,
				details: {
					...details,
					studioArtifacts: [ checkpointArtifact( manifest ), ...( details.studioArtifacts ?? [] ) ],
				},
			};
		},
	};
}
