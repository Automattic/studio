import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

/** A 16:10 site screenshot frame with a hairline ring; an img child fills it from the top. */
export function PreviewFrame( { className, ...props }: ComponentProps< 'span' > ) {
	return (
		<span data-slot="preview-frame" className={ clsx( styles.frame, className ) } { ...props } />
	);
}
