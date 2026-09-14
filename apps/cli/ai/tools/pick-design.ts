import { randomUUID } from 'node:crypto';
import { Type } from 'typebox';
import {
	DESIGN_CATALOGS,
	DESIGN_OPTIONS,
	drawDesignEntries,
	findDesignEntry,
	loadDesignCatalog,
	MAX_CHOSEN_LAYOUTS,
} from 'cli/ai/design-catalog';
import { recordDesignTracksEvent, type DesignTracksContext } from 'cli/ai/design-tracks';
import { TRACKS_EVENTS } from 'cli/lib/tracks';
import { defineTool } from './define-tool';
import { textResult } from './utils';

// Without a question tool (MCP, non-interactive runs) there is nobody to pick,
// so the schema offers a single entry and a stray `options: 4` is coerced.
export function createPickDesignTool( {
	canAskUser,
	tracks,
}: {
	canAskUser: boolean;
	tracks?: DesignTracksContext;
} ) {
	const shown = { directions: [] as string[], layouts: [] as string[] };
	return defineTool(
		'pick_design',
		canAskUser
			? `Returns entries from one catalog of the visual-design skill (load it first: names must match its catalogs exactly), each with its full notes: "directions" for the look, "layouts" for the page structure. \`options\` is how many come back: \`options: ${ DESIGN_OPTIONS }\` for the user to pick from, \`options: 1\` to build directly. Directions are all yours: pass exactly that many in \`chosen\`, each with a one-line reason; none is drawn at random. Layouts mix yours with chance: up to ${ MAX_CHOSEN_LAYOUTS } in \`chosen\`, and the rest are drawn at random and shuffled in so the user cannot tell which is which. Call once per catalog, and again only when the user asks for other options: what they have seen is left out until the catalog runs low. Build what is returned or picked.`
			: 'Returns one entry from one catalog of the visual-design skill (load it first: names must match its catalogs exactly), with its full notes: "directions" for the look, "layouts" for the page structure. The user cannot be asked in this session, so there is nothing to pick from: build what is returned. For directions, pass the one you will build in `chosen`, with a reason. For layouts, pass one in `chosen` only when the brief names it or a reference site points to it; otherwise one is drawn at random. Call once per catalog.',
		{
			catalog: Type.Union( [ Type.Literal( 'directions' ), Type.Literal( 'layouts' ) ], {
				description: '"directions" for the look, "layouts" for the page structure.',
			} ),
			options: canAskUser
				? Type.Integer( {
						minimum: 1,
						maximum: DESIGN_OPTIONS,
						description: `How many entries come back: ${ DESIGN_OPTIONS } when the user will pick one, 1 when they will not.`,
				  } )
				: Type.Literal( 1, { description: 'Always 1: the user cannot be asked in this session.' } ),
			chosen: Type.Optional(
				Type.Array(
					Type.Object( {
						name: Type.String( { description: 'Catalog entry name, verbatim.' } ),
						reason: Type.String( { description: 'One line on why it suits the site.' } ),
					} ),
					{
						maxItems: DESIGN_OPTIONS,
						description: `Your entries: every direction, or up to ${ MAX_CHOSEN_LAYOUTS } layouts.`,
					}
				)
			),
		},
		async ( args ) => {
			const count = canAskUser ? args.options : 1;
			const seen = canAskUser ? shown[ args.catalog ] : [];
			const isRedraw = seen.length > 0;
			if ( loadDesignCatalog( args.catalog ).length - seen.length < count ) {
				seen.length = 0;
			}
			const entries = drawDesignEntries( {
				kind: args.catalog,
				count,
				chosen: args.chosen?.map( ( entry ) => entry.name ),
				shown: seen,
			} );
			seen.push( ...entries.map( ( entry ) => entry.name ) );
			const chosen = new Set(
				args.chosen?.map( ( entry ) => findDesignEntry( args.catalog, entry.name )?.name )
			);
			const drawId = randomUUID();
			for ( const [ index, entry ] of entries.entries() ) {
				await recordDesignTracksEvent( TRACKS_EVENTS.CODE_DESIGN_OPTION_PROPOSED, tracks, {
					catalog: args.catalog,
					option: entry.name,
					position: index + 1,
					is_chosen: chosen.has( entry.name ),
					options_count: entries.length,
					is_redraw: isRedraw,
					draw_id: drawId,
				} );
			}
			const { label } = DESIGN_CATALOGS[ args.catalog ];
			const sections = entries.map(
				( entry, index ) =>
					`${ entries.length > 1 ? `Option ${ index + 1 }\n\n` : '' }${ label }: ${ entry.name }\n${
						entry.description
					}\n\n${ entry.details }`
			);
			if ( ! canAskUser && args.options !== 1 ) {
				sections.push(
					'The user cannot be asked in this session, so one entry came back instead of options to pick from. Build it.'
				);
			}
			return textResult( sections.join( '\n\n---\n\n' ) );
		}
	);
}

export const pickDesignTool = createPickDesignTool( { canAskUser: false } );
