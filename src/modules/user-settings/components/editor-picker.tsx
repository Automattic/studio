import { SelectControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { SupportedEditor } from 'src/modules/user-settings/lib/editor';
import {
	useGetInstalledAppsQuery,
	selectInstalledEditors,
	selectUninstalledEditors,
} from 'src/stores/installed-apps-api';
import { SettingsFormField } from './settings-form-field';

interface EditorPickerProps {
	value: SupportedEditor | undefined;
	onChange: ( value: SupportedEditor ) => void;
}

export const EditorPicker = ( { value, onChange }: EditorPickerProps ) => {
	const { __ } = useI18n();
	const { installedEditors, uninstalledEditors } = useGetInstalledAppsQuery( undefined, {
		selectFromResult: ( result ) => ( {
			installedEditors: selectInstalledEditors( result.data ),
			uninstalledEditors: selectUninstalledEditors( result.data ),
		} ),
	} );

	return (
		<SettingsFormField label={ __( 'Code editor' ) }>
			<SelectControl
				value={ value }
				onChange={ ( newValue ) => onChange( newValue as SupportedEditor ) }
				__nextHasNoMarginBottom
				__next40pxDefaultSize
			>
				{ ! value && <option value={ '' }>{ __( 'Select' ) }</option> }
				{ installedEditors.map( ( [ editorKey, editorConfig ] ) => (
					<option key={ editorKey } value={ editorKey }>
						{ editorConfig.label }
					</option>
				) ) }
				{ uninstalledEditors.length > 0 && (
					<optgroup label={ __( 'Not installed' ) }>
						{ uninstalledEditors.map( ( [ editorKey, editorConfig ] ) => (
							<option key={ editorKey } value={ editorKey } disabled>
								{ editorConfig.label }
							</option>
						) ) }
					</optgroup>
				) }
			</SelectControl>
		</SettingsFormField>
	);
};
