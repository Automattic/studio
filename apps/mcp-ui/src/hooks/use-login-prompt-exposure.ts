import { useEffect, useRef } from 'react';
import { recordLoginEvent } from '@/data/bridge';

export function useLoginPromptExposure( journeyId: string ) {
	const ref = useRef< HTMLDivElement >( null );
	const recorded = useRef( false );
	useEffect( () => {
		const node = ref.current;
		if ( ! node ) return;
		let visible = false;
		const record = () => {
			if (
				! visible ||
				recorded.current ||
				document.visibilityState === 'hidden' ||
				node.closest( '[hidden], [aria-hidden="true"]' )
			)
				return;
			recorded.current = true;
			void recordLoginEvent( { event: 'prompt_viewed', journeyId } ).catch( () => undefined );
		};
		const observer = new IntersectionObserver( ( entries ) => {
			visible = entries.some( ( entry ) => entry.isIntersecting );
			record();
		} );
		observer.observe( node );
		document.addEventListener( 'visibilitychange', record );
		return () => {
			observer.disconnect();
			document.removeEventListener( 'visibilitychange', record );
		};
	}, [ journeyId ] );
	return ref;
}
