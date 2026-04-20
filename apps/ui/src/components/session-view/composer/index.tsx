import { __ } from '@wordpress/i18n';
import { arrowUp, chevronDownSmall } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { useCallback, useState } from 'react';
import styles from './style.module.css';

function PaperclipIcon() {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.6"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M21 11.5 12.5 20a5.5 5.5 0 0 1-7.78-7.78l9.2-9.2a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.2a1.5 1.5 0 0 1-2.12-2.12l8.49-8.49" />
		</svg>
	);
}

interface ComposerProps {
	busy: boolean;
	isInterrupting?: boolean;
	error: string | null;
	onSend: ( prompt: string ) => Promise< void >;
	onInterrupt: () => Promise< void >;
}

const isMacPlatform =
	typeof navigator !== 'undefined' && /mac/i.test( navigator.platform || navigator.userAgent );

export function Composer( {
	busy,
	isInterrupting = false,
	error,
	onSend,
	onInterrupt,
}: ComposerProps ) {
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

	const canSend = value.trim().length > 0;
	const placeholder = busy
		? __( 'Queue a follow-up instruction…' )
		: __( 'Set your next instruction…' );
	const sendAriaLabel = busy ? __( 'Queue' ) : __( 'Send' );
	const modKey = isMacPlatform ? '⌘' : 'Ctrl';

	return (
		<div className={ styles.root }>
			<div className={ styles.shell }>
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
					rows={ 2 }
				/>
				<div className={ styles.toolbar }>
					<div className={ styles.leftActions }>
						<button
							type="button"
							className={ styles.iconButton }
							aria-label={ __( 'Attach file' ) }
							disabled
						>
							<PaperclipIcon />
						</button>
						<button
							type="button"
							className={ `${ styles.iconButton } ${ styles.glyphButton }` }
							aria-label={ __( 'Commands' ) }
							disabled
						>
							/
						</button>
						<button
							type="button"
							className={ `${ styles.iconButton } ${ styles.glyphButton }` }
							aria-label={ __( 'Mention' ) }
							disabled
						>
							@
						</button>
					</div>
					<div className={ styles.rightActions }>
						<button type="button" className={ styles.pill } disabled>
							<span className={ styles.pillDot } aria-hidden="true" />
							<span>{ __( 'Local' ) }</span>
							<Icon icon={ chevronDownSmall } size={ 16 } />
						</button>
						<button type="button" className={ styles.pill } disabled>
							<span>{ __( 'Claude Sonnet 4.5' ) }</span>
							<Icon icon={ chevronDownSmall } size={ 16 } />
						</button>
						{ busy ? (
							<button
								type="button"
								className={ styles.stopButton }
								onClick={ () => void onInterrupt() }
								aria-label={ isInterrupting ? __( 'Stopping' ) : __( 'Stop' ) }
								aria-busy={ isInterrupting }
								title={
									isInterrupting ? __( 'Stopping… click again to force stop' ) : __( 'Stop' )
								}
							>
								<span className={ styles.stopGlyph } aria-hidden="true" />
							</button>
						) : null }
						<button
							type="button"
							className={ styles.sendButton }
							onClick={ () => void send() }
							disabled={ ! canSend }
							aria-label={ sendAriaLabel }
						>
							<Icon icon={ arrowUp } size={ 18 } />
						</button>
					</div>
				</div>
			</div>
			<div className={ styles.meta }>
				<span className={ styles.metaHint }>
					{ modKey }↩ { __( 'to send' ) } · shift↩ { __( 'for newline' ) }
				</span>
				{ error ? <span className={ styles.error }>{ error }</span> : null }
				<span className={ styles.metaUses }>{ __( 'Uses 1 message' ) }</span>
			</div>
		</div>
	);
}
