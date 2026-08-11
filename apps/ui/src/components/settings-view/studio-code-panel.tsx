import { GLOBAL_INSTRUCTIONS_MAX_LENGTH } from '@studio/common/ai/global-instructions';
import { DataForm } from '@wordpress/dataviews';
import { __ } from '@wordpress/i18n';
import { useEffect, useRef, useState } from 'react';
import {
	useAgentInstructions,
	useSaveAgentInstructions,
} from '@/data/queries/use-agent-instructions';
import styles from './style.module.css';
import type { Field, Form } from '@wordpress/dataviews';

interface FormData {
	content: string;
}

const FIELDS: Field< FormData >[] = [
	{
		id: 'content',
		type: 'text',
		label: __( 'Instructions' ),
		description: __(
			'Global instructions for the Studio Code agent. They are included in every new conversation, across all sites.'
		),
		placeholder: __( 'e.g. Always answer in French. My sites are for restaurants.' ),
		Edit: { control: 'textarea', rows: 12 },
	},
];

const FORM: Form = {
	layout: { type: 'regular', labelPosition: 'top' },
	fields: [ 'content' ],
};

// Long enough that a normal typing burst lands as one write, short enough that
// the save still feels immediate when the user pauses.
const SAVE_DEBOUNCE_MS = 800;

export function StudioCodePanel() {
	const { data: saved } = useAgentInstructions();
	const { mutate: save, isError } = useSaveAgentInstructions();
	const [ edits, setEdits ] = useState< string | null >( null );

	const content = edits ?? saved ?? '';
	const isDirty = saved !== undefined && content !== saved;

	const pending = useRef< string | null >( null );
	// The latest content and the value this visit to the tab started from, so leaving can save any
	// un-flushed keystrokes and report the whole session as one change however many autosaves it took.
	const latest = useRef< string | null >( null );
	const sessionStart = useRef< string | null >( null );

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

	// Leaving the tab ends the edit session. Save once more — flushing any keystrokes the debounce
	// hasn't written yet — and pass the value the session started from so the change is counted once
	// rather than once per typing pause. When the debounce already wrote everything this is a no-op
	// write that only carries the comparison.
	useEffect(
		() => () => {
			const previousContent = sessionStart.current;
			if ( previousContent === null || latest.current === null ) {
				return;
			}
			if ( pending.current === null && latest.current === previousContent ) {
				return;
			}
			save( { content: latest.current, editSession: { previousContent } } );
		},
		[ save ]
	);

	if ( saved === undefined ) {
		return <div className={ styles.state }>{ __( 'Loading…' ) }</div>;
	}

	const showCounter = content.length >= GLOBAL_INSTRUCTIONS_MAX_LENGTH * 0.8;

	return (
		<div className={ styles.preferencesPanel }>
			<DataForm< FormData >
				data={ { content } }
				fields={ FIELDS }
				form={ FORM }
				onChange={ ( update ) =>
					setEdits(
						( ( update.content as string ) ?? '' ).slice( 0, GLOBAL_INSTRUCTIONS_MAX_LENGTH )
					)
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
		</div>
	);
}
