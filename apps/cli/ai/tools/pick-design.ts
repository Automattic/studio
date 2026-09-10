import { Type } from 'typebox';
import { pickDesignEntries, type DesignCatalogKind, type DesignEntry } from 'cli/ai/skills';
import { defineTool } from './define-tool';
import { textResult } from './utils';

export const MAX_DESIGN_OPTIONS = 4;

const candidateList = ( description: string ) =>
	Type.Optional(
		Type.Array(
			Type.Object( {
				name: Type.String( { description: 'Catalog entry name, verbatim.' } ),
				reason: Type.String( { description: 'One line on why it suits this site.' } ),
			} ),
			{ description }
		)
	);

const namedInBrief = ( description: string ) => Type.Optional( Type.String( { description } ) );

const HEADINGS: Record< DesignCatalogKind, { drawn: string; named: string } > = {
	concept: { drawn: 'Drawn layout concept', named: 'Layout concept named in the brief' },
	direction: {
		drawn: 'Drawn artistic direction',
		named: 'Artistic direction named in the brief',
	},
};

const describeEntry = ( kind: DesignCatalogKind, entry: DesignEntry, drawn: boolean ) =>
	`${ drawn ? HEADINGS[ kind ].drawn : HEADINGS[ kind ].named }: ${ entry.name }\n\n${
		entry.body
	}`;

export const pickDesignTool = defineTool(
	'pick_design',
	'Draws the signature layout concept and the artistic direction for a site build in one call. For each, pass the shortlist of catalog entries that suit the site (at least three, from the matching pool in the visual-design skill), each with a one-line reason; the tool picks one of each at random and returns their notes. Build what is returned — do not re-pick. If the user named a catalog entry in their brief, pass it as layoutNamedInBrief or directionNamedInBrief instead and it is returned without a draw. Pass only one side when the other is already settled, for example a redesign that keeps its layout. Pass `options: 4` only when the user will pick one (present_design_options in the Studio app, AskUserQuestion elsewhere): the tool then draws up to four distinct concept-and-direction pairs, numbered, and you build the one the user picks.',
	{
		layoutCandidates: candidateList(
			'Layout concept shortlist to draw from, from the concept pool.'
		),
		layoutNamedInBrief: namedInBrief(
			'A catalog layout concept the user asked for by name; returned without a draw.'
		),
		directionCandidates: candidateList(
			'Artistic direction shortlist to draw from, from the direction pool.'
		),
		directionNamedInBrief: namedInBrief(
			'A catalog artistic direction the user asked for by name; returned without a draw.'
		),
		options: Type.Optional(
			Type.Integer( {
				minimum: 1,
				maximum: MAX_DESIGN_OPTIONS,
				description:
					'How many distinct concept-and-direction pairs to draw. Defaults to 1. Use 4 only when the user will pick one.',
			} )
		),
	},
	async ( args ) => {
		const count = args.options ?? 1;
		const requests: Array<
			[ DesignCatalogKind, { name: string }[] | undefined, string | undefined ]
		> = [
			[ 'concept', args.layoutCandidates, args.layoutNamedInBrief ],
			[ 'direction', args.directionCandidates, args.directionNamedInBrief ],
		];
		const sides = requests
			.filter( ( [ , candidates, named ] ) => candidates?.length || named )
			.map( ( [ kind, candidates, named ] ) => ( {
				kind,
				...pickDesignEntries(
					kind,
					{
						candidates: ( candidates ?? [] ).map( ( candidate ) => candidate.name ),
						namedInBrief: named,
					},
					count
				),
			} ) );
		if ( ! sides.length ) {
			throw new Error(
				'Pass a layout concept shortlist, an artistic direction shortlist, or both.'
			);
		}

		// A side named in the brief is fixed across every option, so it is
		// stated once up front; only the drawn sides vary per option.
		const fixed = sides.filter( ( side ) => ! side.drawn );
		const varying = sides.filter( ( side ) => side.drawn );
		const optionCount = Math.max( 1, ...varying.map( ( side ) => side.entries.length ) );
		if ( count === 1 || optionCount === 1 ) {
			return textResult(
				sides
					.map( ( side ) => describeEntry( side.kind, side.entries[ 0 ], side.drawn ) )
					.join( '\n\n---\n\n' )
			);
		}

		const sections = fixed.map( ( side ) => describeEntry( side.kind, side.entries[ 0 ], false ) );
		for ( let index = 0; index < optionCount; index++ ) {
			const parts = varying.map( ( side ) =>
				describeEntry( side.kind, side.entries[ index % side.entries.length ], true )
			);
			sections.push( `Option ${ index + 1 }\n\n${ parts.join( '\n\n' ) }` );
		}
		sections.push(
			`Let the user pick one, in this order: present_design_options with a sneak-peek HTML per option when that tool is available, otherwise AskUserQuestion with one text option per pair. Build the pair the user picks.`
		);
		return textResult( sections.join( '\n\n---\n\n' ) );
	}
);
