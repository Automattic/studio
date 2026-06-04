import { Type } from 'typebox';
import { parseManifest } from 'cli/ai/generation/manifest';
import { generateSite } from 'cli/ai/generation/orchestrate';
import { defineTool } from './define-tool';
import { resolveSite, textResult } from './utils';

function normalizeSpecJson( spec: string ): string {
	const trimmed = spec.trim();
	try {
		return JSON.stringify( JSON.parse( trimmed ), null, 2 );
	} catch {
		return JSON.stringify( { description: trimmed }, null, 2 );
	}
}

export const generateSiteTool = defineTool(
	'generate_site',
	'Generates a COMPLETE WordPress site in ONE call: a pure-presentation block theme + a companion plugin (when the spec needs behaviour) + seeded page/post/CPT content with AI imagery. Runs ALL generation (theme files, plugin main + JSX blocks, page bodies, CPT entries) as a single parallel pool — the long-pole calls overlap the rest instead of running phase-by-phase — then writes and activates the theme, writes + compiles + activates the plugin, and seeds content into the live database in one pass. Returns the resolved MANIFEST (same as generate_theme), so you can still run generate_image and validation afterward. Best run after generate_design_previews. This supersedes calling generate_theme + generate_companion_plugin + seed_content in sequence; those remain available for manual/granular use.',
	{
		nameOrPath: Type.String( {
			description: 'The site name or filesystem path of the target site.',
		} ),
		spec: Type.String( {
			description:
				'The site spec as a JSON string (site type, audience, tone, layout preference, pages, features).',
		} ),
		design: Type.Optional(
			Type.String( {
				description:
					'The chosen design direction — the first-fold HTML from generate_design_previews, or a detailed prose brief. Strongly recommended for visual coherence.',
			} )
		),
		manifest: Type.Optional(
			Type.String( {
				description:
					'Optional file manifest JSON (from a prior call). When omitted, a manifest is generated from the spec.',
			} )
		),
		withImages: Type.Optional(
			Type.Boolean( {
				description:
					'Fill AI_IMAGE placeholders with generated imagery (default true; requires WordPress.com login). When false or not logged in, placeholders are removed instead.',
			} )
		),
	},
	async ( args ) => {
		const site = await resolveSite( args.nameOrPath );
		const result = await generateSite( {
			site,
			specJson: normalizeSpecJson( args.spec ),
			design: args.design?.trim() || '',
			manifest: args.manifest ? parseManifest( args.manifest ) : undefined,
			withImages: args.withImages ?? true,
		} );
		return textResult( result.summary );
	}
);
