import { Collapsible } from '@base-ui/react/collapsible';
import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

/**
 * Content that folds its height open and shut, mounted only while open. Once
 * it has finished opening it is marked `data-settled`, so content that may
 * overflow it, like a drop marker, can show without spilling out mid-fold.
 */
export function CollapsiblePanel( {
	open,
	className,
	...props
}: Omit< ComponentProps< typeof Collapsible.Panel >, 'render' > & { open: boolean } ) {
	return (
		<Collapsible.Root open={ open } className={ styles.root }>
			<Collapsible.Panel
				className={ clsx( styles.panel, className ) }
				render={ ( panelProps, state ) => {
					// Base UI holds the measured height while the panel moves and
					// returns it to `auto` once the panel is fully open.
					const height = ( panelProps.style as Record< string, unknown > | undefined )?.[
						'--collapsible-panel-height'
					];
					const settled = state.open && state.transitionStatus !== 'starting' && height === 'auto';
					return <div { ...panelProps } data-settled={ settled || undefined } />;
				} }
				{ ...props }
			/>
		</Collapsible.Root>
	);
}
