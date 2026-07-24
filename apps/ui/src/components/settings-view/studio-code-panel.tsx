import { GLOBAL_INSTRUCTIONS_MAX_LENGTH } from '@studio/common/ai/global-instructions';
import { FormToggle } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useEffect, useRef, useState } from 'react';
import {
	useAgentInstructions,
	useSaveAgentInstructions,
} from '@/data/queries/use-agent-instructions';
import { usePreviewAgenticFeatures } from './settings-preview';
import styles from './style.module.css';

// Long enough that a normal typing burst lands as one write, short enough that
// the save still feels immediate when the user pauses.
const SAVE_DEBOUNCE_MS = 800;

export function StudioCodePanel() {
	const { reason } = usePreviewAgenticFeatures();
	const { data: saved } = useAgentInstructions();
	const { mutate: save, isError } = useSaveAgentInstructions();
	const [ edits, setEdits ] = useState< string | null >( null );
	// null until the user flips the switch, so the toggle defaults to on
	// whenever there are already saved instructions.
	const [ userEnabled, setUserEnabled ] = useState< boolean | null >( null );

	const content = edits ?? saved ?? '';
	const isDirty = saved !== undefined && content !== saved;
	const enabled = userEnabled ?? ( saved?.length ?? 0 ) > 0;

	const pending = useRef< string | null >( null );
	const textareaRef = useRef< HTMLTextAreaElement >( null );

	// Grow the editor to fit its content, from a compact starting height.
	useEffect( () => {
		const el = textareaRef.current;
		if ( ! el ) {
			return;
		}
		el.style.height = 'auto';
		el.style.height = `${ el.scrollHeight }px`;
	}, [ content, enabled, reason ] );

	useEffect( () => {
		pending.current = isDirty ? content : null;
		if ( ! isDirty ) {
			return;
		}
		const timer = setTimeout( () => {
			pending.current = null;
			save( content );
		}, SAVE_DEBOUNCE_MS );
		return () => clearTimeout( timer );
	}, [ content, isDirty, save ] );

	// Leaving the tab mid-debounce would otherwise drop the last keystrokes.
	useEffect(
		() => () => {
			if ( pending.current !== null ) {
				save( pending.current );
			}
		},
		[ save ]
	);

	if ( saved === undefined ) {
		return <div className={ styles.state }>{ __( 'Loading…' ) }</div>;
	}

	const signedOut = reason === 'signed-out';
	const showCounter = enabled && content.length >= GLOBAL_INSTRUCTIONS_MAX_LENGTH * 0.8;

	// Turning the switch off both hides the editor and clears the stored
	// instructions, so "off" genuinely means the agent gets none.
	const handleToggle = () => {
		if ( enabled ) {
			setUserEnabled( false );
			setEdits( '' );
		} else {
			setUserEnabled( true );
		}
	};

	return (
		<section className={ clsx( styles.card, signedOut && styles.cardDisabled ) }>
			<div className={ styles.cardHeader }>
				<div className={ styles.cardHeaderText }>
					<h2 className={ styles.cardTitle }>{ __( 'Instructions' ) }</h2>
					<p className={ styles.cardDescription }>
						{ __(
							'Global instructions for the Studio Code agent. They are included in every new conversation, across all sites.'
						) }
					</p>
				</div>
				<div className={ clsx( styles.cardHeaderActions, styles.toggleControl ) }>
					<FormToggle
						checked={ enabled && ! signedOut }
						disabled={ signedOut }
						aria-label={ __( 'Enable instructions' ) }
						onChange={ handleToggle }
					/>
				</div>
			</div>
			{ signedOut && (
				<p className={ styles.signInNotice }>{ __( 'You must log in for agent instructions.' ) }</p>
			) }
			{ ! signedOut && enabled && (
				<>
					<textarea
						ref={ textareaRef }
						className={ styles.instructionsTextarea }
						aria-label={ __( 'Instructions' ) }
						rows={ 3 }
						placeholder={ __( 'e.g. Always answer in French. My sites are for restaurants.' ) }
						value={ content }
						onChange={ ( event ) =>
							setEdits( event.target.value.slice( 0, GLOBAL_INSTRUCTIONS_MAX_LENGTH ) )
						}
					/>
					{ isError && (
						<p className={ styles.instructionsError }>
							{ __( 'Saving the instructions failed. Please try again.' ) }
						</p>
					) }
					{ showCounter && (
						<div className={ styles.actions }>
							<span className={ styles.instructionsCounter }>
								{ `${ content.length.toLocaleString() } / ${ GLOBAL_INSTRUCTIONS_MAX_LENGTH.toLocaleString() }` }
							</span>
						</div>
					) }
				</>
			) }
		</section>
	);
}
