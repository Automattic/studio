import styles from './popover-row.module.css';
import type { ReactNode } from 'react';

type Props = {
	label: ReactNode;
	sublabel?: ReactNode;
	action?: ReactNode;
};

export function PopoverRow( { label, sublabel, action }: Props ) {
	return (
		<div className={ styles.row }>
			<div className={ styles.text }>
				<div className={ styles.label }>{ label }</div>
				{ sublabel ? <div className={ styles.sublabel }>{ sublabel }</div> : null }
			</div>
			{ action ? <div className={ styles.action }>{ action }</div> : null }
		</div>
	);
}
