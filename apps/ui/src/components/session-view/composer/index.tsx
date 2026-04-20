import { __ } from '@wordpress/i18n';
import { useCallback, useState } from 'react';
import styles from './style.module.css';

interface ComposerProps {
	disabled: boolean;
	error: string | null;
	onSend: ( prompt: string ) => Promise< void >;
	onInterrupt: () => Promise< void >;
}

export function Composer( { disabled, error, onSend, onInterrupt }: ComposerProps ) {
	const [ value, setValue ] = useState( '' );

	const send = useCallback( async () => {
		const trimmed = value.trim();
		if ( ! trimmed || disabled ) {
			return;
		}
		setValue( '' );
		try {
			await onSend( trimmed );
		} catch {
			// Restore the draft so the user can retry; the parent surfaces the
			// error message via `error`.
			setValue( trimmed );
		}
	}, [ value, disabled, onSend ] );

	return (
		<div className={ styles.root }>
			<textarea
				className={ styles.input }
				placeholder={ __( 'Set your next instruction…' ) }
				value={ value }
				onChange={ ( event ) => setValue( event.target.value ) }
				onKeyDown={ ( event ) => {
					if ( event.key === 'Enter' && ( event.metaKey || event.ctrlKey ) ) {
						event.preventDefault();
						void send();
					}
				} }
				disabled={ disabled }
				rows={ 3 }
			/>
			<div className={ styles.footer }>
				{ error ? <span className={ styles.error }>{ error }</span> : null }
				<div className={ styles.actions }>
					{ disabled ? (
						<button type="button" className={ styles.button } onClick={ () => void onInterrupt() }>
							{ __( 'Stop' ) }
						</button>
					) : (
						<button
							type="button"
							className={ styles.button }
							onClick={ () => void send() }
							disabled={ ! value.trim() }
						>
							{ __( 'Send' ) }
						</button>
					) }
				</div>
			</div>
		</div>
	);
}
