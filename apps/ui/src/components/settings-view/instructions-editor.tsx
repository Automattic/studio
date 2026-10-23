import { GLOBAL_INSTRUCTIONS_MAX_LENGTH } from '@studio/common/ai/global-instructions-length';
import { __ } from '@wordpress/i18n';
import { useEffect, useId, useRef, useState } from 'react';
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldLabel,
} from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import {
	useAgentInstructions,
	useSaveAgentInstructions,
} from '@/data/queries/use-agent-instructions';
import styles from './style.module.css';

// Long enough that a typing burst lands as one write, short enough that the
// save still feels immediate when the user pauses.
const SAVE_DEBOUNCE_MS = 800;

export function InstructionsEditor() {
	const { data: saved } = useAgentInstructions();
	const { mutate: save, isError } = useSaveAgentInstructions();
	const [ edits, setEdits ] = useState< string | null >( null );
	const id = useId();

	const content = edits ?? saved ?? '';
	const isDirty = saved !== undefined && content !== saved;

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

	if ( saved === undefined ) {
		return <div className={ styles.state }>{ __( 'Loading…' ) }</div>;
	}

	return (
		<Field>
			<FieldContent>
				<div className={ styles.instructionsHeader }>
					<FieldLabel htmlFor={ id }>{ __( 'Studio instructions' ) }</FieldLabel>
					<FieldDescription>
						{ `${ content.length.toLocaleString() } / ${ GLOBAL_INSTRUCTIONS_MAX_LENGTH.toLocaleString() }` }
					</FieldDescription>
				</div>
				<FieldDescription width="full">
					{ __( 'Add your own guidance for Studio Code.' ) }
				</FieldDescription>
			</FieldContent>
			<Textarea
				id={ id }
				sizing="fixed"
				rows={ 10 }
				maxLength={ GLOBAL_INSTRUCTIONS_MAX_LENGTH }
				placeholder={ __( 'e.g. Always answer in French. My sites are for restaurants.' ) }
				value={ content }
				onChange={ ( event ) => setEdits( event.target.value ) }
			/>
			<FieldError>
				{ isError ? __( 'Saving the instructions failed. Please try again.' ) : null }
			</FieldError>
		</Field>
	);
}
