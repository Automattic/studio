import { Type } from 'typebox';
import {
	drawDesignPairs,
	MAX_CHOSEN_DESIGN_PAIRS,
	type DesignCatalogKind,
	type DesignEntry,
	type DesignPair,
} from 'cli/ai/skills';
import { defineTool } from './define-tool';
import { textResult } from './utils';

export const DESIGN_OPTIONS_TO_PRESENT = 4;

const HEADINGS: Record< DesignCatalogKind, { open: string; named: string } > = {
	concept: { open: 'Layout concept', named: 'Layout concept named in the brief' },
	direction: { open: 'Artistic direction', named: 'Artistic direction named in the brief' },
};

const describeEntry = ( kind: DesignCatalogKind, entry: DesignEntry, named = false ) =>
	`${ named ? HEADINGS[ kind ].named : HEADINGS[ kind ].open }: ${ entry.name }\n${
		entry.description
	}\n\n${ entry.details }`;

const nameList = ( description: string ) =>
	Type.Optional( Type.Array( Type.String(), { description } ) );

export const pickDesignTool = defineTool(
	'pick_design',
	`Settles the signature layout concept and the artistic direction for a site build. With \`options: ${ DESIGN_OPTIONS_TO_PRESENT }\` it returns ${ DESIGN_OPTIONS_TO_PRESENT } distinct concept-and-direction pairs for the user to pick from: up to ${ MAX_CHOSEN_DESIGN_PAIRS } pairs you choose from the catalogs in the visual-design skill (each with a one-line reason), plus random draws for the rest, shuffled so the user cannot tell which is which. With \`options: 1\` it draws one random pair and you build it. Every pair comes back with its full build notes. If the user named a catalog entry in their brief, pass it as layoutNamedInBrief or directionNamedInBrief: it is fixed across every pair without a draw. Put entries that contradict a hard constraint of the brief in \`avoid\` so they are never drawn. Call once; build what is returned or picked.`,
	{
		options: Type.Union( [ Type.Literal( 1 ), Type.Literal( DESIGN_OPTIONS_TO_PRESENT ) ], {
			description: `${ DESIGN_OPTIONS_TO_PRESENT } when the user will pick one, 1 when they will not.`,
		} ),
		chosen: Type.Optional(
			Type.Array(
				Type.Object( {
					layout: Type.String( { description: 'Layout concept name from the catalog, verbatim.' } ),
					direction: Type.String( {
						description: 'Artistic direction name from the catalog, verbatim.',
					} ),
					reason: Type.String( { description: 'One line on why this pair suits the site.' } ),
				} ),
				{
					maxItems: MAX_CHOSEN_DESIGN_PAIRS,
					description: `Up to ${ MAX_CHOSEN_DESIGN_PAIRS } pairs you judge a good fit. Only with options: ${ DESIGN_OPTIONS_TO_PRESENT }.`,
				}
			)
		),
		avoid: Type.Optional(
			Type.Object(
				{
					layouts: nameList( 'Layout concepts that contradict the brief.' ),
					directions: nameList( 'Artistic directions that contradict the brief.' ),
				},
				{ description: 'Catalog entries never to draw, because the brief rules them out.' }
			)
		),
		layoutNamedInBrief: Type.Optional(
			Type.String( { description: 'A catalog layout concept the user asked for by name.' } )
		),
		directionNamedInBrief: Type.Optional(
			Type.String( { description: 'A catalog artistic direction the user asked for by name.' } )
		),
	},
	async ( args ) => {
		if ( args.options === 1 && args.chosen?.length ) {
			throw new Error(
				`Pass chosen pairs only with options: ${ DESIGN_OPTIONS_TO_PRESENT }; a single draw is random.`
			);
		}
		const draw = drawDesignPairs( {
			count: args.options,
			chosen: args.chosen,
			avoid: args.avoid,
			layoutNamedInBrief: args.layoutNamedInBrief,
			directionNamedInBrief: args.directionNamedInBrief,
		} );

		// A side named in the brief is fixed across every option, so it is
		// stated once up front; only the open sides vary per option.
		const sections: string[] = [];
		if ( draw.fixed.concept ) {
			sections.push( describeEntry( 'concept', draw.fixed.concept, true ) );
		}
		if ( draw.fixed.direction ) {
			sections.push( describeEntry( 'direction', draw.fixed.direction, true ) );
		}
		const describePair = ( pair: DesignPair ) =>
			[
				draw.fixed.concept ? null : describeEntry( 'concept', pair.layout ),
				draw.fixed.direction ? null : describeEntry( 'direction', pair.direction ),
			]
				.filter( Boolean )
				.join( '\n\n' );
		if ( draw.pairs.length === 1 ) {
			const only = describePair( draw.pairs[ 0 ] );
			if ( only ) sections.push( only );
		} else {
			draw.pairs.forEach( ( pair, index ) => {
				sections.push( `Option ${ index + 1 }\n\n${ describePair( pair ) }` );
			} );
			sections.push(
				'Let the user pick one, in this order: present_design_options with a sneak-peek HTML per option when that tool is available, otherwise AskUserQuestion with one text option per pair. Build the pair the user picks.'
			);
		}
		if ( draw.ignored.length ) {
			sections.push(
				`Not catalog entries, so those pairs were replaced by random draws: ${ draw.ignored.join(
					', '
				) }.`
			);
		}
		return textResult( sections.join( '\n\n---\n\n' ) );
	}
);
