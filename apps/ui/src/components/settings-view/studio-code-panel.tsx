import { GLOBAL_INSTRUCTIONS_MAX_LENGTH } from '@studio/common/ai/global-instructions-constants';
import { FormToggle } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useEffect, useRef, useState } from 'react';
import {
	useAgentInstructions,
	useSaveAgentInstructions,
	useSetAgentInstructionsEnabled,
} from '@/data/queries/use-agent-instructions';
import styles from './style.module.css';
import { SAVE_DEBOUNCE_MS } from './use-debounced-save';

export function StudioCodePanel() {
	const { data: settings } = useAgentInstructions();
	const { mutate: save, isError } = useSaveAgentInstructions();
	const setEnabled = useSetAgentInstructionsEnabled();
	const [ edits, setEdits ] = useState< string | null >( null );

	const saved = settings?.content;
	const content = edits ?? saved ?? '';
	const isDirty = saved !== undefined && content !== saved;
	const enabled = settings?.enabled ?? false;

	const pending = useRef< string | null >( null );
	// Latest content, and the value this visit started from.
	const latest = useRef< string | null >( null );
	const sessionStart = useRef< string | null >( null );
	// Read through a ref so the cleanup below can run on unmount only.
	const saveRef = useRef( save );

	useEffect( () => {
		saveRef.current = save;
	}, [ save ] );

	useEffect( () => {
		if ( sessionStart.current === null && saved !== undefined ) {
			sessionStart.current = saved;
		}
	}, [ saved ] );

	useEffect( () => {
		pending.current = isDirty ? content : null;
		latest.current = content;
		if ( ! isDirty ) {
			return;
		}
		const timer = setTimeout( () => {
			pending.current = null;
			save( { content } );
		}, SAVE_DEBOUNCE_MS );
		return () => clearTimeout( timer );
	}, [ content, isDirty, save ] );

	// Leaving the tab ends the edit session: flush any un-written keystrokes and pass the value it
	// started from, so the change counts once rather than once per typing pause. No deps — this must
	// run on unmount only, or an edit would be reported twice.
	useEffect(
		() => () => {
			const previousContent = sessionStart.current;
			if ( previousContent === null || latest.current === null ) {
				return;
			}
			if ( pending.current === null && latest.current === previousContent ) {
				return;
			}
			sessionStart.current = latest.current;
			saveRef.current( { content: latest.current, editSession: { previousContent } } );
		},
		[]
	);

	if ( settings === undefined ) {
		return <div className={ styles.state }>{ __( 'Loading…' ) }</div>;
	}

	const showCounter = enabled && content.length >= GLOBAL_INSTRUCTIONS_MAX_LENGTH * 0.8;

	const handleToggle = () => {
		setEnabled.mutate( ! enabled );
	};

	return (
		<section className={ styles.preferenceSectionGroup }>
			<section className={ styles.preferenceRow }>
				<div className={ styles.preferenceText }>
					<h2>{ __( 'Instructions' ) }</h2>
					<p>
						{ __(
							'Global instructions for the Studio Code agent. They are included in every new conversation, across all sites.'
						) }
					</p>
				</div>
				<div className={ clsx( styles.preferenceControl, styles.toggleControl ) }>
					<FormToggle
						checked={ enabled }
						aria-label={ __( 'Enable instructions' ) }
						aria-controls="agent-instructions-editor"
						onChange={ handleToggle }
					/>
				</div>
			</section>
			{ enabled ? (
				<textarea
					id="agent-instructions-editor"
					className={ styles.instructionsTextarea }
					aria-label={ __( 'Instructions' ) }
					rows={ 3 }
					placeholder={ __( 'e.g. Always answer in French. My sites are for restaurants.' ) }
					value={ content }
					onChange={ ( event ) =>
						setEdits( event.target.value.slice( 0, GLOBAL_INSTRUCTIONS_MAX_LENGTH ) )
					}
				/>
			) : null }
			{ isError && (
				<p className={ styles.instructionsError }>
					{ __( 'Saving the instructions failed. Please try again.' ) }
				</p>
			) }
			{ setEnabled.isError && (
				<p className={ styles.instructionsError }>
					{ __( 'Updating the instructions setting failed. Please try again.' ) }
				</p>
			) }
			{ showCounter && (
				<div className={ styles.actions }>
					<span className={ styles.instructionsCounter }>
						{ `${ content.length.toLocaleString() } / ${ GLOBAL_INSTRUCTIONS_MAX_LENGTH.toLocaleString() }` }
					</span>
				</div>
			) }
		</section>
	);
}
