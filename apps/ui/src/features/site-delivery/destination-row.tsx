import { Button } from '@studio/ds';
import styles from './style.module.css';
import type { ComponentProps, ReactNode } from 'react';

export function DestinationRow( {
	icon,
	label,
	labelAdornment,
	description,
	trailing,
	...props
}: Omit< ComponentProps< typeof Button >, 'children' > & {
	icon: ReactNode;
	label: string | undefined;
	labelAdornment?: ReactNode;
	description?: ReactNode;
	trailing?: ReactNode;
} ) {
	const content = (
		<>
			<span className={ styles.destinationRowIcon }>{ icon }</span>
			<span className={ styles.previewAddress }>
				<span className={ styles.destinationRowTitle }>
					<span className={ styles.previewHostname } title={ label }>
						{ label }
					</span>
					{ labelAdornment }
				</span>
				{ description && (
					<span
						className={ styles.destinationRowDescription }
						title={ typeof description === 'string' ? description : undefined }
					>
						{ description }
					</span>
				) }
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
