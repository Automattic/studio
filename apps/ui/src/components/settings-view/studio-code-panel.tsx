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
