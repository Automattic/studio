import { useMemo } from 'react';
import { useWelcomeMessages } from './use-welcome-messages';

export function useRotatePromptMessages( siteId: string ) {
	const { examplePrompts } = useWelcomeMessages();

	// Shuffle the prompts and limit to 3 for the initial view
	const randomizedPrompts = useMemo( () => {
		const shuffled = [ ...examplePrompts ].sort( () => 0.5 - Math.random() );
		return shuffled;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ examplePrompts, siteId ] );

	return { randomizedPrompts };
}
