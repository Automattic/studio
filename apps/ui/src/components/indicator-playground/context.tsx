import { createContext, useContext, useState, type PropsWithChildren } from 'react';
import { IndicatorPlaygroundControls } from './controls';

export type IndicatorPreviewChoice = 'auto' | 'off' | 'working';

interface IndicatorPlaygroundState {
	sidebar: IndicatorPreviewChoice;
	conversation: IndicatorPreviewChoice;
}

interface IndicatorPlaygroundValue extends IndicatorPlaygroundState {
	setSidebar: ( value: IndicatorPreviewChoice ) => void;
	setConversation: ( value: IndicatorPreviewChoice ) => void;
}

const DEFAULT_STATE: IndicatorPlaygroundState = {
	sidebar: 'auto',
	conversation: 'auto',
};

const IndicatorPlaygroundContext = createContext< IndicatorPlaygroundValue >( {
	...DEFAULT_STATE,
	setSidebar: () => undefined,
	setConversation: () => undefined,
} );

export function IndicatorPlaygroundProvider( { children }: PropsWithChildren ) {
	const [ sidebar, setSidebar ] = useState< IndicatorPreviewChoice >( 'auto' );
	const [ conversation, setConversation ] = useState< IndicatorPreviewChoice >( 'auto' );
	const value = { sidebar, conversation, setSidebar, setConversation };

	return (
		<IndicatorPlaygroundContext.Provider value={ value }>
			{ children }
			{ import.meta.env.DEV ? (
				<IndicatorPlaygroundControls
					sidebar={ sidebar }
					conversation={ conversation }
					setSidebar={ setSidebar }
					setConversation={ setConversation }
				/>
			) : null }
		</IndicatorPlaygroundContext.Provider>
	);
}

export function useIndicatorPlayground() {
	return useContext( IndicatorPlaygroundContext );
}
