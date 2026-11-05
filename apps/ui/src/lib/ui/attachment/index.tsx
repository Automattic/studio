import { clsx } from 'clsx';
import { XIcon } from 'lucide-react';
import { IconButton, type ButtonProps } from '@/lib/ui/button';
import styles from './style.module.css';

export function DismissButton( {
	className,
	label,
	...props
}: Omit< ButtonProps, 'variant' | 'size' | 'shape' | 'children' > & { label: string } ) {
	return (
		<IconButton
			{ ...props }
			icon={
				<span className={ styles.face }>
					<XIcon />
				</span>
			}
			label={ label }
			data-slot="attachment-remove"
			data-color-scheme="light"
			variant="ghost"
			size="icon-2xs"
			shape="round"
			className={ clsx( styles.remove, className ) }
		/>
	);
}

export { DismissButton as AttachmentRemoveButton };
