import { createContext, useContext } from 'react';

export interface StackAnimationContextValue {
	pressedStackId: string | null;
	pressStack: ( stackId: string ) => void;
}

export const StackAnimationContext = createContext< StackAnimationContextValue | null >( null );

export function useStackAnimation() {
	const context = useContext( StackAnimationContext );
	if ( ! context ) {
		throw new Error( 'useStackAnimation must be used inside StackAnimationContext.Provider.' );
	}

	return context;
}
