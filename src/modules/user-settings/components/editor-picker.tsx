import { SelectControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { SupportedEditor, supportedEditorConfig } from 'src/modules/user-settings/lib/editor';
import { useGetInstalledAppsQuery } from 'src/stores/installed-apps-api';
import { SettingsFormField } from './settings-form-field';

interface EditorPickerProps {
	value: SupportedEditor;
	onChange: ( value: SupportedEditor ) => void;
}

export const EditorPicker = ( { value, onChange }: EditorPickerProps ) => {
	const { __ } = useI18n();
	const { data: installedApps } = useGetInstalledAppsQuery();

	console.log( installedApps );

	const installedEditors = Object.entries( supportedEditorConfig ).filter(
		( [ editor ] ) => installedApps && installedApps[ editor as keyof typeof installedApps ]
	);

	const uninstalledEditors = Object.entries( supportedEditorConfig ).filter(
		( [ editor ] ) => ! installedApps || ! installedApps[ editor as keyof typeof installedApps ]
	);

	return (
		<SettingsFormField label={ __( 'Code editor' ) }>
			<SelectControl
				value={ value }
				onChange={ ( newValue ) => onChange( newValue as SupportedEditor ) }
				__nextHasNoMarginBottom
				__next40pxDefaultSize
			>
				{ installedEditors.map( ( [ editorKey, editorConfig ] ) => (
					<option key={ editorKey } value={ editorKey }>
						{ editorConfig.label }
					</option>
				) ) }
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
