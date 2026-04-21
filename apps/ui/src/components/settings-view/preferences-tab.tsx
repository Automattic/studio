import { SUPPORTED_EDITORS, supportedEditorConfig } from '@studio/common/lib/user-settings/editor';
import { SUPPORTED_TERMINALS, terminalConfig } from '@studio/common/lib/user-settings/terminal';
import { DataForm } from '@wordpress/dataviews';
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useInstalledApps } from '@/data/queries/use-installed-apps';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import styles from './style.module.css';
import type {
	ColorScheme,
	InstalledApps,
	SupportedEditor,
	SupportedTerminal,
	UserPreferences,
	WritableUserPreferences,
} from '@/data/core';
import type { Field, Form } from '@wordpress/dataviews';
import type { FormEvent } from 'react';

// Empty-string sentinel for "not set" — DataForm's select-style fields need a
// primitive value, so we can't use null directly.
const UNSET = '' as const;

type FormData = {
	editor: SupportedEditor | typeof UNSET;
	terminal: SupportedTerminal | typeof UNSET;
	colorScheme: ColorScheme;
};

function toFormData( prefs: UserPreferences ): FormData {
	return {
		editor: prefs.editor ?? UNSET,
		terminal: prefs.terminal ?? UNSET,
		colorScheme: prefs.colorScheme,
	};
}

function diffFromSaved(
	next: FormData,
	saved: UserPreferences
): Partial< WritableUserPreferences > {
	const patch: Partial< WritableUserPreferences > = {};
	const nextEditor: SupportedEditor | null = next.editor === UNSET ? null : next.editor;
	const nextTerminal: SupportedTerminal | null = next.terminal === UNSET ? null : next.terminal;
	if ( nextEditor !== saved.editor ) patch.editor = nextEditor;
	if ( nextTerminal !== saved.terminal ) patch.terminal = nextTerminal;
	if ( next.colorScheme !== saved.colorScheme ) patch.colorScheme = next.colorScheme;
	return patch;
}

function editorElements( installedApps: InstalledApps | undefined ) {
	const options = SUPPORTED_EDITORS.filter(
		( editor ) => ! installedApps || installedApps[ editor ]
	).map( ( editor ) => ( {
		value: editor,
		label: supportedEditorConfig[ editor ].label,
	} ) );
	return [ { value: UNSET, label: __( 'Not set' ) }, ...options ];
}

function terminalElements( installedApps: InstalledApps | undefined ) {
	const options = SUPPORTED_TERMINALS.filter(
		( terminal ) => ! installedApps || installedApps[ terminal ]
	).map( ( terminal ) => ( {
		value: terminal,
		label: terminalConfig[ terminal ].name,
	} ) );
	return [ { value: UNSET, label: __( 'Not set' ) }, ...options ];
}

const COLOR_SCHEME_ELEMENTS: { value: ColorScheme; label: string }[] = [
	{ value: 'system', label: __( 'System' ) },
	{ value: 'light', label: __( 'Light' ) },
	{ value: 'dark', label: __( 'Dark' ) },
];

export function PreferencesTab() {
	const { data: saved, isLoading } = useUserPreferences();
	const { data: installedApps } = useInstalledApps();
	const savePreferences = useSaveUserPreferences();

	const [ data, setData ] = useState< FormData | null >( null );
	useEffect( () => {
		if ( saved ) {
			setData( toFormData( saved ) );
		}
	}, [ saved ] );

	const fields = useMemo< Field< FormData >[] >(
		() => [
			{
				id: 'editor',
				type: 'text',
				label: __( 'Preferred editor' ),
				elements: editorElements( installedApps ),
			},
			{
				id: 'terminal',
				type: 'text',
				label: __( 'Preferred terminal' ),
				elements: terminalElements( installedApps ),
			},
			{
				id: 'colorScheme',
				type: 'text',
				label: __( 'Appearance' ),
				elements: COLOR_SCHEME_ELEMENTS,
			},
		],
		[ installedApps ]
	);

	const form = useMemo< Form >(
		() => ( {
			layout: { type: 'regular', labelPosition: 'top' },
			fields: [ 'editor', 'terminal', 'colorScheme' ],
		} ),
		[]
	);

	const handleChange = useCallback( ( update: Record< string, unknown > ) => {
		setData( ( prev ) => ( prev ? { ...prev, ...( update as Partial< FormData > ) } : prev ) );
	}, [] );

	if ( isLoading || ! data || ! saved ) {
		return <p>{ __( 'Loading…' ) }</p>;
	}

	const patch = diffFromSaved( data, saved );
	const isDirty = Object.keys( patch ).length > 0;
	const canSubmit = isDirty && ! savePreferences.isPending;

	const handleSubmit = ( event: FormEvent ) => {
		event.preventDefault();
		if ( ! canSubmit ) return;
		savePreferences.mutate( patch );
	};

	return (
		<form onSubmit={ handleSubmit } className={ styles.form }>
			<DataForm< FormData >
				data={ data }
				fields={ fields }
				form={ form }
				onChange={ handleChange }
			/>
			<div className={ styles.actions }>
				<Button
					type="submit"
					variant="solid"
					tone="brand"
					disabled={ ! canSubmit }
					loading={ savePreferences.isPending }
					loadingAnnouncement={ __( 'Saving settings' ) }
				>
					{ __( 'Save settings' ) }
				</Button>
			</div>
		</form>
	);
}
