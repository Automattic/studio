import { AI_MODELS } from '@studio/common/ai/models';
import { AI_SKILL_COMMANDS } from '@studio/common/ai/slash-commands';
import { __ } from '@wordpress/i18n';
import { arrowUp, chevronDownSmall } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { useCallback, useState } from 'react';
import * as Menu from '@/components/menu';
import { EnvironmentPill } from './environment-pill';
import styles from './style.module.css';
import type { AiModelId, SyncSite } from '@/data/core';

/**
 * Invisible structural placeholder that mirrors Composer's outer DOM (shell +
 * textarea + toolbar + meta row) so the loading state can reserve the exact
 * same vertical space without rendering a visible composer. Heights track the
 * real composer's CSS automatically — no magic numbers that drift when the
 * composer changes.
 */
export function ComposerSkeleton() {
	return (
		<div className={ styles.root } style={ { visibility: 'hidden' } } aria-hidden="true">
			<div className={ styles.shell }>
				<textarea className={ styles.input } rows={ 2 } disabled tabIndex={ -1 } />
				<div className={ styles.toolbar }>
					<span className={ styles.pill } />
				</div>
			</div>
			<div className={ styles.meta }>{ '\u00A0' }</div>
		</div>
	);
}

interface ComposerProps {
	busy: boolean;
	isInterrupting?: boolean;
	error: string | null;
	model: AiModelId;
	onModelChange: ( model: AiModelId ) => void;
	onSend: ( prompt: string ) => Promise< void >;
	onInterrupt: () => Promise< void >;
	// Environment pill: only rendered when both a `sessionId` and a linked
	// `liveSite` are available. Without a live link the pill is hidden
	// entirely (there'd be nothing to flip to).
	sessionId?: string;
	effectiveEnvironment?: 'local' | 'live';
	liveSite?: SyncSite;
}

const isMacPlatform =
	typeof navigator !== 'undefined' && /mac/i.test( navigator.platform || navigator.userAgent );

export function Composer( {
	busy,
	isInterrupting = false,
	error,
	model,
	onModelChange,
	onSend,
	onInterrupt,
	sessionId,
	effectiveEnvironment = 'local',
	liveSite,
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
						<Menu.Root modal={ false }>
							<Menu.Trigger
								render={
									<button
										type="button"
										className={ `${ styles.iconButton } ${ styles.glyphButton }` }
										aria-label={ __( 'Commands' ) }
									>
										/
									</button>
								}
							/>
							<Menu.Popup side="top" align="start" className={ styles.commandsMenuPopup }>
								{ AI_SKILL_COMMANDS.map( ( command ) => (
									<Menu.Item
										key={ command.name }
										onClick={ () => {
											void onSend( `/${ command.name }` );
										} }
									>
										<span className={ styles.commandItem }>
											<span className={ styles.commandName }>/{ command.name }</span>
											<span className={ styles.commandDescription }>{ command.description }</span>
										</span>
									</Menu.Item>
								) ) }
							</Menu.Popup>
						</Menu.Root>
					</div>
					<div className={ styles.rightActions }>
						{ sessionId && liveSite ? (
							<EnvironmentPill
								sessionId={ sessionId }
								effectiveEnvironment={ effectiveEnvironment }
								liveSite={ liveSite }
								disabled={ busy }
							/>
						) : null }
						<Menu.Root modal={ false }>
							<Menu.Trigger
								render={
									<button
										type="button"
										className={ styles.pill }
										aria-label={ __( 'Select model' ) }
									>
										<span>{ AI_MODELS[ model ] }</span>
										<Icon icon={ chevronDownSmall } size={ 16 } />
									</button>
								}
							/>
							<Menu.Popup side="top" align="end">
								<Menu.RadioGroup
									value={ model }
									onValueChange={ ( value ) => onModelChange( value as AiModelId ) }
								>
									{ ( Object.entries( AI_MODELS ) as [ AiModelId, string ][] ).map(
										( [ id, label ] ) => (
											<Menu.RadioItem key={ id } value={ id }>
												{ label }
											</Menu.RadioItem>
										)
									) }
								</Menu.RadioGroup>
							</Menu.Popup>
						</Menu.Root>
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
