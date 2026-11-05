import { __, sprintf } from '@wordpress/i18n';
import { ChevronRightIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { Button, CollapsiblePanel, FieldError } from '@/lib/ui';
import styles from './style.module.css';
import type { ReactNode } from 'react';

export function SettingsSection( {
	label,
	summary,
	error,
	children,
}: {
	label: string;
	summary: string;
	error?: string;
	children: ReactNode;
} ) {
	const [ open, setOpen ] = useState( false );
	const id = useId();
	const errorId = `${ id }-error`;
	return (
		<div role="group" aria-label={ label }>
			<Button
				variant="ghost"
				className={ styles.settingsTrigger }
				aria-label={ sprintf( __( 'Edit %s' ), label ) }
				aria-describedby={ error && ! open ? errorId : undefined }
				aria-expanded={ open }
				aria-controls={ id }
				onClick={ () => setOpen( ! open ) }
			>
				<span>{ label }</span>
				<span className={ styles.settingsValue } data-error={ !! error || undefined }>
					<span>{ summary }</span>
					<ChevronRightIcon className={ styles.settingsCaret } aria-hidden="true" />
				</span>
			</Button>
			{ ! open ? <FieldError id={ errorId }>{ error }</FieldError> : null }
			<CollapsiblePanel open={ open } id={ id }>
				<div className={ styles.settingsFields }>{ children }</div>
			</CollapsiblePanel>
		</div>
	);
}
