import { useMemo } from 'react';
import { useWelcomeMessages } from '../hooks/use-welcome-messages';

export function useRotateWelcomeMessages( siteId: string ) {
	const { examplePrompts } = useWelcomeMessages();

	//Limit to 3 and shuffle initial prompts
	const randomizedPrompts = useMemo( () => {
		const shuffled = [ ...examplePrompts ].sort( () => 0.5 - Math.random() );
		return shuffled.slice( 0, 3 );
	}, [ examplePrompts, siteId ] );

	return { randomizedPrompts };
}
