import { clsx } from 'clsx';
import { useState } from 'react';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

/** A 16:10 site screenshot frame with a hairline ring. */
export function PreviewFrame( { className, ...props }: ComponentProps< 'span' > ) {
	return (
		<span data-slot="preview-frame" className={ clsx( styles.frame, className ) } { ...props } />
	);
}

/** The frame's screenshot, filled from the top when available. */
export function PreviewImage( { src, className, ...props }: ComponentProps< 'img' > ) {
	const [ failedSrc, setFailedSrc ] = useState< string >();
	if ( ! src || src === failedSrc ) {
		return null;
	}
	return (
		<img
			src={ src }
			className={ clsx( styles.image, className ) }
			onError={ () => setFailedSrc( src ) }
			{ ...props }
		/>
	);
}
