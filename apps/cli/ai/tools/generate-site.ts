import { Type } from 'typebox';
import { parseManifest } from 'cli/ai/generation/manifest';
import { runSiteGeneration, type SiteGenerationMode } from 'cli/ai/generation/orchestrate';
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

function normalizeMode( mode: string | undefined, apply: boolean | undefined ): SiteGenerationMode {
	if ( mode === undefined || mode === '' ) {
		return apply === false ? 'guided' : 'one-shot';
	}
	if ( mode === 'guided' || mode === 'one-shot' ) {
		return mode;
	}
	throw new Error( 'mode must be either "guided" or "one-shot".' );
}

export const generateSiteTool = defineTool(
	'generate_site',
	'Generates a complete WordPress site through the SiteGenerationEngine: plan, generate artifacts, validate, optionally apply, then hand back to the agent for polish. mode:"one-shot" is the default and writes/activates/seeds in one call. mode:"guided" defaults to apply:false and stages a review payload with the manifest, warnings, and exact generated artifacts before touching the site filesystem or database. Pass stagedRunId with apply:true to apply reviewed guided artifacts without regenerating. This is the normal site-generator facade; lower-level phase tools are advanced/debug surfaces.',
	{
		nameOrPath: Type.String( {
			description: 'The site name or filesystem path of the target site.',
		} ),
		spec: Type.Optional(
			Type.String( {
				description:
					'The site spec as a JSON string (site type, audience, tone, layout preference, pages, features). Required unless stagedRunId is provided.',
			} )
		),
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
		mode: Type.Optional(
			Type.String( {
				description:
					'Generation mode: "one-shot" applies the generated site immediately; "guided" returns generated artifacts for review first. Default is "one-shot", or "guided" when apply is false.',
			} )
		),
		apply: Type.Optional(
			Type.Boolean( {
				description:
					'Whether to write files, activate packages, and seed the database. Defaults to true for one-shot and false for guided.',
			} )
		),
		stagedRunId: Type.Optional(
			Type.String( {
				description:
					'Run id returned by a prior guided generation. When set with apply:true, applies those exact staged artifacts instead of regenerating.',
			} )
		),
	},
	async ( args, context ) => {
		const site = await resolveSite( args.nameOrPath );
		if ( ! args.stagedRunId && ! args.spec?.trim() ) {
			throw new Error( 'spec is required unless stagedRunId is provided.' );
		}
		const mode = normalizeMode( args.mode?.trim(), args.apply );
		const shouldApply = args.apply ?? mode === 'one-shot';
		const result = await runSiteGeneration( {
			site,
			specJson: args.spec ? normalizeSpecJson( args.spec ) : '{}',
			design: args.design?.trim() || '',
			manifest: args.manifest ? parseManifest( args.manifest ) : undefined,
			withImages: args.withImages ?? true,
			mode,
			apply: shouldApply,
			stagedRunId: args.stagedRunId?.trim() || undefined,
			services: {
				signal: context?.signal,
				onProgress: ( message ) => {
					context?.onUpdate?.( { content: [ { type: 'text', text: message } ], details: {} } );
				},
			},
		} );
		return textResult( result.summary );
	}
);
