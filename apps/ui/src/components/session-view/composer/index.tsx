import { __ } from '@wordpress/i18n';
import { useCallback, useState } from 'react';
import styles from './style.module.css';

interface ComposerProps {
	busy: boolean;
	error: string | null;
	onSend: ( prompt: string ) => Promise< void >;
	onInterrupt: () => Promise< void >;
}

export function Composer( { busy, error, onSend, onInterrupt }: ComposerProps ) {
	const [ value, setValue ] = useState( '' );

	const send = useCallback( async () => {
		const trimmed = value.trim();
		if ( ! trimmed ) {
			return;
		}
		setValue( '' );
		try {
			await onSend( trimmed );
		} catch {
			// Restore the draft so the user can retry; the parent surfaces the
			// error message via `error`. Queued sends never throw from onSend
			// (the parent swallows the failure and clears the queue instead),
			// so this path only trips for direct sends from the idle state.
			setValue( trimmed );
		}
	}, [ value, onSend ] );

	const placeholder = busy
		? __( 'Queue a follow-up instruction…' )
		: __( 'Set your next instruction…' );
	const sendLabel = busy ? __( 'Queue' ) : __( 'Send' );

	return (
		<div className={ styles.root }>
			<textarea
				className={ styles.input }
				placeholder={ placeholder }
				value={ value }
				onChange={ ( event ) => setValue( event.target.value ) }
				onKeyDown={ ( event ) => {
					if ( event.key === 'Enter' && ( event.metaKey || event.ctrlKey ) ) {
						event.preventDefault();
						void send();
					}
				} }
				rows={ 3 }
			/>
			<div className={ styles.footer }>
				{ error ? <span className={ styles.error }>{ error }</span> : null }
				<div className={ styles.actions }>
					{ busy ? (
						<button type="button" className={ styles.button } onClick={ () => void onInterrupt() }>
							{ __( 'Stop' ) }
						</button>
					) : null }
					<button
						type="button"
						className={ styles.button }
						onClick={ () => void send() }
						disabled={ ! value.trim() }
					>
						{ sendLabel }
					</button>
				</div>
			</div>
		</div>
	);
}
