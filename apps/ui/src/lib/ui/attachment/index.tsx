import { clsx } from 'clsx';
import { XIcon } from 'lucide-react';
import { Button, type ButtonProps } from '@/lib/ui/button';
import styles from './style.module.css';

export function AttachmentRemoveButton( {
	className,
	...props
}: Omit< ButtonProps, 'variant' | 'size' | 'shape' | 'children' > ) {
	return (
		<Button
			{ ...props }
			data-slot="attachment-remove"
			data-color-scheme="light"
			variant="ghost"
			size="icon-2xs"
			shape="round"
			className={ clsx( styles.remove, className ) }
		>
			<XIcon />
		</Button>
	);
}
