import { GLOBAL_INSTRUCTIONS_MAX_LENGTH } from '@studio/common/ai/global-instructions';
import { DataForm } from '@wordpress/dataviews';
import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import {
	useAgentInstructions,
	useSaveAgentInstructions,
} from '@/data/queries/use-agent-instructions';
import styles from './style.module.css';
import { useDebouncedSave } from './use-debounced-save';
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

export function StudioCodePanel() {
	const { data: saved } = useAgentInstructions();
	const { mutate: save, isError } = useSaveAgentInstructions();
	const [ edits, setEdits ] = useState< string | null >( null );

	const content = edits ?? saved ?? '';
	const isDirty = saved !== undefined && content !== saved;

	useDebouncedSave( isDirty ? content : undefined, save );

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
