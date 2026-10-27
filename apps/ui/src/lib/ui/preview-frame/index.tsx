import { clsx } from 'clsx';
import { useState } from 'react';
import { Skeleton } from '@/lib/ui/skeleton';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

/** A 16:10 site screenshot frame with a hairline ring. */
export function PreviewFrame( { className, ...props }: ComponentProps< 'span' > ) {
	return (
		<span data-slot="preview-frame" className={ clsx( styles.frame, className ) } { ...props } />
	);
}

/** The frame's screenshot, filled from the top; a skeleton stands in while it loads, or when it's missing or fails. */
export function PreviewImage( { src, className, ...props }: ComponentProps< 'img' > ) {
	const [ state, setState ] = useState< 'loading' | 'ready' | 'error' >( 'loading' );
	return (
		<>
			{ src && state !== 'error' ? (
				<img
					src={ src }
					className={ clsx( styles.image, className ) }
					onLoad={ () => setState( 'ready' ) }
					onError={ () => setState( 'error' ) }
					{ ...props }
				/>
			) : null }
			{ ! src || state !== 'ready' ? (
				<Skeleton className={ styles.skeleton } aria-hidden="true" />
			) : null }
		</>
	);
}
