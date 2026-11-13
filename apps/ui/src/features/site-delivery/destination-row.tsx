import { Button } from '@/lib/ui';
import styles from './style.module.css';
import type { ComponentProps, ReactNode } from 'react';

export function DestinationRow( {
	icon,
	label,
	description,
	trailing,
	...props
}: Omit< ComponentProps< typeof Button >, 'children' > & {
	icon: ReactNode;
	label: string | undefined;
	description?: ReactNode;
	trailing?: ReactNode;
} ) {
	const content = (
		<>
			<span className={ styles.destinationRowIcon }>{ icon }</span>
			<span className={ styles.previewAddress }>
				<span className={ styles.previewHostname } title={ label }>
					{ label }
				</span>
				{ description && <span className={ styles.expiry }>{ description }</span> }
			</span>
			{ trailing && <span className={ styles.addressExternalIcon }>{ trailing }</span> }
		</>
	);
	return (
		<Button variant="ghost" className={ styles.destinationRowControl } { ...props }>
			{ content }
		</Button>
	);
}
