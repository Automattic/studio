import { GLOBAL_INSTRUCTIONS_MAX_LENGTH } from '@studio/common/ai/global-instructions';
import { DataForm } from '@wordpress/dataviews';
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { useEffect, useState } from 'react';
import {
	useAgentInstructions,
	useSaveAgentInstructions,
} from '@/data/queries/use-agent-instructions';
import styles from './style.module.css';
import type { Field, Form } from '@wordpress/dataviews';
import type { FormEvent } from 'react';

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
	const saveInstructions = useSaveAgentInstructions();
	const [ edits, setEdits ] = useState< string | null >( null );
	const [ justSaved, setJustSaved ] = useState( false );

	useEffect( () => {
		if ( ! justSaved ) {
			return;
		}
		const timer = setTimeout( () => setJustSaved( false ), 2500 );
		return () => clearTimeout( timer );
	}, [ justSaved ] );

	if ( saved === undefined ) {
		return <div className={ styles.state }>{ __( 'Loading…' ) }</div>;
	}

	const content = edits ?? saved;
	const isDirty = content !== saved;
	const canSubmit = isDirty && ! saveInstructions.isPending;
	const showCounter = content.length >= GLOBAL_INSTRUCTIONS_MAX_LENGTH * 0.8;

	const handleSubmit = ( event: FormEvent ) => {
		event.preventDefault();
		if ( ! canSubmit ) {
			return;
		}
		saveInstructions.mutate( content, {
			onSuccess: () => {
				setEdits( null );
				setJustSaved( true );
			},
		} );
	};

	return (
		<form onSubmit={ handleSubmit } className={ styles.preferencesPanel }>
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
			{ saveInstructions.isError && (
				<p className={ styles.instructionsError }>
					{ __( 'Saving the instructions failed. Please try again.' ) }
				</p>
			) }
			<div className={ styles.actions }>
				{ showCounter && (
					<span className={ styles.instructionsCounter }>
						{ `${ content.length.toLocaleString() } / ${ GLOBAL_INSTRUCTIONS_MAX_LENGTH.toLocaleString() }` }
					</span>
				) }
				<Button
					type="submit"
					variant="solid"
					tone="brand"
					disabled={ ! canSubmit }
					loading={ saveInstructions.isPending }
					loadingAnnouncement={ __( 'Saving instructions' ) }
				>
					{ justSaved && ! isDirty ? __( 'Saved' ) : __( 'Save instructions' ) }
				</Button>
			</div>
		</form>
	);
}
