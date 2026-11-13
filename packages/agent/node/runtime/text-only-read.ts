/**
 * Pi's read tool returns an image file as an image block. A model that cannot
 * view images gets the block dropped on the way to the provider and only the
 * "Read image file" line, which reads as though it saw the file. For such a
 * model the image is replaced with what it does get, as take_screenshot says
 * of its captures.
 */
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { TSchema } from 'typebox';

export const TEXT_ONLY_IMAGE_NOTE =
	'This model cannot view images, so the image is not shown to you; its type and size, above, are what it has.';

export function withTextOnlyImages< S extends TSchema >( tool: AgentTool< S > ): AgentTool< S > {
	return {
		...tool,
		execute: async ( ...args ) => {
			const result = await tool.execute( ...args );
			if ( ! result.content.some( ( part ) => part.type === 'image' ) ) {
				return result;
			}
			return {
				...result,
				content: [
					...result.content.filter( ( part ) => part.type !== 'image' ),
					{ type: 'text', text: TEXT_ONLY_IMAGE_NOTE },
				],
			};
		},
	};
}
