import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { Type } from 'typebox';
import { runGenerator } from 'cli/ai/generation/generators';
import { completeText, extractJson, runPooled } from 'cli/ai/generation/llm';
import { openBrowser } from 'cli/lib/browser';
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

interface DirectionBrief {
	name: string;
	brief: string;
}

async function planDirections( specJson: string, count: number ): Promise< DirectionBrief[] > {
	const raw = await completeText( {
		system: `You are an art director. Given a website spec, invent ${ count } RADICALLY DISTINCT visual design directions grounded in the site's topic and industry — not a generic style menu. Each should feel like a different designer made it (different typography, color strategy, layout philosophy, mood). Avoid generic AI aesthetics. Output ONLY a JSON array of exactly ${ count } objects of shape {"name": "short evocative name", "brief": "2-3 sentences: color strategy with hex codes, exact Google Font pairings, layout philosophy, mood"}. No prose, no code fences.`,
		user: `SITE SPEC (JSON):\n${ specJson }`,
		maxTokens: 2_000,
		temperature: 0.9,
	} );

	try {
		const parsed = JSON.parse( extractJson( raw ) ) as unknown;
		if ( Array.isArray( parsed ) ) {
			const briefs = parsed
				.filter( ( d ): d is Record< string, unknown > => !! d && typeof d === 'object' )
				.map( ( d, i ) => ( {
					name:
						typeof d.name === 'string' && d.name.trim() ? d.name.trim() : `Direction ${ i + 1 }`,
					brief: typeof d.brief === 'string' ? d.brief.trim() : '',
				} ) );
			if ( briefs.length ) {
				return briefs.slice( 0, count );
			}
		}
	} catch {
		// Fall through to generic briefs below.
	}

	return Array.from( { length: count }, ( _, i ) => ( {
		name: `Direction ${ i + 1 }`,
		brief: 'Invent a distinct, topic-grounded direction that differs clearly from the others.',
	} ) );
}

export const generateDesignPreviewsTool = defineTool(
	'generate_design_previews',
	"Generates several distinct visual design directions as self-contained first-fold HTML previews (header + hero) and writes them to <site>/design/design-N.html, opening each in the browser. Use this BEFORE generate_site so the user can pick a direction; pass the chosen preview's HTML (or its brief) as the `design` argument to generate_site. Each direction is grounded in the site's topic, not a generic template.",
	{
		nameOrPath: Type.String( {
			description: 'The site name or filesystem path of the target site.',
		} ),
		spec: Type.String( {
			description: 'The site spec as a JSON string (site type, audience, tone, topic).',
		} ),
		directions: Type.Optional(
			Type.Number( { description: 'How many directions to generate (default 3, max 4).' } )
		),
	},
	async ( args ) => {
		const site = await resolveSite( args.nameOrPath );
		const specJson = normalizeSpecJson( args.spec );
		const count = Math.max( 1, Math.min( 4, Math.round( args.directions ?? 3 ) ) );

		const designDir = path.join( site.path, 'design' );
		await mkdir( designDir, { recursive: true } );

		const briefs = await planDirections( specJson, count );

		const htmls = await runPooled(
			briefs.map( ( brief, index ) => async () => {
				const html = await runGenerator( {
					name: 'design-direction',
					specJson,
					task: `Direction ${ index + 1 } of ${ count }.\nName: ${ brief.name }\nBrief: ${
						brief.brief
					}\nMake this direction clearly distinct from the others.`,
					maxTokens: 12_000,
					temperature: 0.8,
				} );
				return { brief, html, index };
			} ),
			Math.min( count, 3 )
		);

		const written: Array< { name: string; file: string } > = [];
		for ( const { brief, html, index } of htmls ) {
			const file = path.join( designDir, `design-${ index + 1 }.html` );
			await writeFile( file, html, 'utf8' );
			written.push( { name: brief.name, file } );
			try {
				await openBrowser( `file://${ file }` );
			} catch {
				// Opening a browser is best-effort; the file path is reported regardless.
			}
		}

		const summary = [
			`Generated ${ written.length } design direction(s) for ${ site.name }:`,
			'',
			...written.map( ( w, i ) => `  ${ i + 1 }. ${ w.name }\n     ${ w.file }` ),
			'',
			"Ask the user to pick one. Then call generate_theme with that preview's HTML (or its brief) as the `design` argument so the full theme matches the chosen direction.",
		].join( '\n' );

		return textResult( summary );
	}
);
