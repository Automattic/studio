import { Type } from 'typebox';
import { pickDesignConcept } from 'cli/ai/skills';
import { defineTool } from './define-tool';
import { textResult } from './utils';

export const pickConceptTool = defineTool(
	'pick_concept',
	'Draws the signature layout concept for a site build. Pass the shortlist of catalog concepts that suit the site (at least three, from the concept pool in the visual-design skill), each with a one-line reason, and the tool picks one at random and returns its build notes. Build the returned concept — do not re-pick. If the user named a catalog concept in their brief, pass it as namedInBrief instead and it is returned without a draw.',
	{
		candidates: Type.Array(
			Type.Object( {
				name: Type.String( { description: 'Catalog concept name, verbatim.' } ),
				reason: Type.String( { description: 'One line on why it suits this site.' } ),
			} ),
			{ description: 'The shortlist to draw from. Ignored when namedInBrief is set.' }
		),
		namedInBrief: Type.Optional(
			Type.String( {
				description: 'A catalog concept the user asked for by name; returned without a draw.',
			} )
		),
	},
	async ( args ) => {
		const { concept, drawn } = pickDesignConcept( {
			candidates: args.candidates.map( ( candidate ) => candidate.name ),
			namedInBrief: args.namedInBrief,
		} );
		const heading = drawn
			? `Drawn concept: ${ concept.name }`
			: `Concept named in the brief: ${ concept.name }`;
		return textResult( `${ heading }\n\n${ concept.body }` );
	}
);
