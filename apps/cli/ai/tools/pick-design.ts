import { Type } from 'typebox';
import { pickDesignEntry } from 'cli/ai/skills';
import { defineTool } from './define-tool';
import { textResult } from './utils';
import type { DesignCatalogKind } from 'cli/ai/skills';

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

export const pickDesignTool = defineTool(
	'pick_design',
	'Draws the signature layout concept and the artistic direction for a site build in one call. For each, pass the shortlist of catalog entries that suit the site (at least three, from the matching pool in the visual-design skill), each with a one-line reason; the tool picks one of each at random and returns their notes. Build what is returned — do not re-pick. If the user named a catalog entry in their brief, pass it as layoutNamedInBrief or directionNamedInBrief instead and it is returned without a draw. Pass only one side when the other is already settled, for example a redesign that keeps its layout.',
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
	},
	async ( args ) => {
		const requests: Array<
			[ DesignCatalogKind, { name: string }[] | undefined, string | undefined ]
		> = [
			[ 'concept', args.layoutCandidates, args.layoutNamedInBrief ],
			[ 'direction', args.directionCandidates, args.directionNamedInBrief ],
		];
		const sections = requests
			.filter( ( [ , candidates, named ] ) => candidates?.length || named )
			.map( ( [ kind, candidates, named ] ) => {
				const { entry, drawn } = pickDesignEntry( kind, {
					candidates: ( candidates ?? [] ).map( ( candidate ) => candidate.name ),
					namedInBrief: named,
				} );
				const heading = drawn ? HEADINGS[ kind ].drawn : HEADINGS[ kind ].named;
				return `${ heading }: ${ entry.name }\n\n${ entry.body }`;
			} );
		if ( ! sections.length ) {
			throw new Error(
				'Pass a layout concept shortlist, an artistic direction shortlist, or both.'
			);
		}
		return textResult( sections.join( '\n\n---\n\n' ) );
	}
);
