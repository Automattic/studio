import { useRender } from '@base-ui/react/use-render';
import { clsx } from 'clsx';
import styles from './style.module.css';

export function AttachmentChip( {
	render,
	className,
	ref,
	font = 'default',
	...props
}: useRender.ComponentProps< 'div' > & { font?: 'default' | 'mono' } ) {
	return useRender( {
		defaultTagName: 'div',
		render,
		ref,
		props: { className: clsx( styles.chip, className ), 'data-font': font, ...props },
	} );
}
