import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { ShareView } from './share-view';

export function usePublishNavigation() {
	const [ view, setView ] = useState< ShareView >( { kind: 'entry' } );
	const section = useRef< HTMLElement >( null );
	const backButton = useRef< HTMLButtonElement >( null );
	const active = useRef< ViewTransition >( undefined );

	const navigate = ( next: ShareView, direction: 'forward' | 'back', focus?: () => void ) => {
		const update = () => {
			flushSync( () => setView( next ) );
			if ( focus ) focus();
			else if ( direction === 'forward' ) backButton.current?.focus();
		};
		const frame = section.current;
		if (
			! frame ||
			! document.startViewTransition ||
			! CSS.supports( 'selector(:active-view-transition-type(publish-forward))' ) ||
			window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches
		) {
			update();
			return;
		}
		active.current?.skipTransition();
		frame.style.minBlockSize = `${ frame.offsetHeight }px`;
		const transition = document.startViewTransition( {
			types: [ `publish-${ direction }` ],
			update,
		} );
		active.current = transition;
		void transition.finished.finally( () => {
			if ( active.current !== transition ) return;
			frame.style.removeProperty( 'min-block-size' );
			active.current = undefined;
		} );
	};
	return { view, setView, navigate, section, backButton };
}
