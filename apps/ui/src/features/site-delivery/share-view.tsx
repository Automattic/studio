import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import styles from './style.module.css';

type View = 'main' | 'publish-setup' | 'overwrite';

export function ShareView( { view, children }: { view: View; children: ReactNode } ) {
	const frameRef = useRef< HTMLDivElement >( null );
	const contentRef = useRef< HTMLDivElement >( null );
	const [ transition, setTransition ] = useState< {
		view: View;
		direction?: 'forward' | 'back';
	} >( { view } );
	if ( transition.view !== view ) {
		setTransition( { view, direction: view === 'main' ? 'back' : 'forward' } );
	}
	useLayoutEffect( () => {
		const frame = frameRef.current;
		const content = contentRef.current;
		if ( ! frame || ! content ) return;
		const measure = () => {
			frame.style.height = `${ content.offsetHeight }px`;
		};
		measure();
		if ( typeof ResizeObserver === 'undefined' ) return;
		const observer = new ResizeObserver( measure );
		observer.observe( content );
		return () => observer.disconnect();
	}, [ view ] );
	return (
		<div ref={ frameRef } className={ styles.viewFrame }>
			<div
				key={ view }
				ref={ contentRef }
				className={ styles.viewMotion }
				data-direction={ transition.direction }
			>
				{ children }
			</div>
		</div>
	);
}
