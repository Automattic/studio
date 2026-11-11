import { useRender } from '@base-ui/react/use-render';
import { clsx } from 'clsx';
import { Button, type ButtonProps } from '@/lib/ui/button';
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

export function AttachmentChipTrigger( { className, ...props }: Omit< ButtonProps, 'variant' > ) {
	return (
		<Button
			{ ...props }
			data-slot="attachment-trigger"
			variant="ghost"
			className={ clsx( styles.trigger, className ) }
		/>
	);
}
