import { SelectControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useEffect, useState } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { SupportedEditor, supportedEditorConfig } from 'src/modules/user-settings/lib/editor';
import { SettingsFormField } from './settings-form-field';

interface EditorPickerProps {
	value: SupportedEditor | undefined;
	onChange: ( value: SupportedEditor | undefined ) => void;
}

export const EditorPicker = ( { value, onChange }: EditorPickerProps ) => {
	const { __ } = useI18n();
	const [ installedApps, setInstalledApps ] = useState< {
		vscode: boolean | null;
		phpstorm: boolean | null;
	} >( {
		vscode: null,
		phpstorm: null,
	} );

	useEffect( () => {
		getIpcApi()
			.getInstalledApps()
			.then( ( apps ) => {
				setInstalledApps( apps );
			} )
			.catch( ( error ) => {
				console.error( 'Failed to fetch installed apps:', error );
			} );
	}, [] );

	const installedEditors = Object.entries( supportedEditorConfig ).filter(
		( [ editor ] ) => installedApps[ editor as keyof typeof installedApps ]
	);

	const uninstalledEditors = Object.entries( supportedEditorConfig ).filter(
		( [ editor ] ) => ! installedApps[ editor as keyof typeof installedApps ]
	);

	return (
		<SettingsFormField label={ __( 'Code editor' ) }>
			<SelectControl
				value={ value }
				onChange={ ( newValue ) => onChange( newValue as SupportedEditor ) }
				__nextHasNoMarginBottom
				__next40pxDefaultSize
			>
				{ ! value && <option value={ '' }>{ __( 'Select' ) }</option> }
				<optgroup label={ __( 'Available editors' ) }>
					{ installedEditors.map( ( [ editorKey, editorConfig ] ) => (
						<option key={ editorKey } value={ editorKey }>
							{ editorConfig.label }
						</option>
					) ) }
				</optgroup>
				<optgroup label={ __( 'Not installed' ) }>
					{ uninstalledEditors.map( ( [ editorKey, editorConfig ] ) => (
						<option key={ editorKey } value={ editorKey } disabled>
							{ editorConfig.label }
						</option>
					) ) }
				</optgroup>
			</SelectControl>
		</SettingsFormField>
	);
};
