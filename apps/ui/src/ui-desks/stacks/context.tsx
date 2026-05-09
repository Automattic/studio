import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import type { ReactNode } from 'react';

interface StackAnimationContextValue {
	pressedStackId: string | null;
	pressStack: ( stackId: string ) => void;
}

const StackAnimationContext = createContext< StackAnimationContextValue | null >( null );

export function StackAnimationProvider( { children }: { children: ReactNode } ) {
	const [ pressedStackId, setPressedStackId ] = useState< string | null >( null );
	const pressTimerRef = useRef< ReturnType< typeof setTimeout > | null >( null );

	const pressStack = useCallback( ( stackId: string ) => {
		if ( pressTimerRef.current ) {
			clearTimeout( pressTimerRef.current );
		}

		setPressedStackId( stackId );
		pressTimerRef.current = setTimeout( () => {
			pressTimerRef.current = null;
			setPressedStackId( ( currentStackId ) =>
				currentStackId === stackId ? null : currentStackId
			);
		}, 180 );
	}, [] );

	useEffect( () => {
		return () => {
			if ( pressTimerRef.current ) {
				clearTimeout( pressTimerRef.current );
			}
		};
	}, [] );

	const value = useMemo(
		() => ( {
			pressedStackId,
			pressStack,
		} ),
		[ pressStack, pressedStackId ]
	);

	return (
		<StackAnimationContext.Provider value={ value }>{ children }</StackAnimationContext.Provider>
	);
}

export function useStackAnimation() {
	const context = useContext( StackAnimationContext );
	if ( ! context ) {
		throw new Error( 'useStackAnimation must be used inside StackAnimationProvider.' );
	}

	return context;
}
