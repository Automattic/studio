import { Collapsible } from '@base-ui/react/collapsible';
import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

/** Content that folds its height open and shut, mounted only while open. */
export function CollapsiblePanel( {
	open,
	className,
	...props
}: ComponentProps< typeof Collapsible.Panel > & { open: boolean } ) {
	return (
		<Collapsible.Root open={ open } className={ styles.root }>
			<Collapsible.Panel className={ clsx( styles.panel, className ) } { ...props } />
		</Collapsible.Root>
	);
}
