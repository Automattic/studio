import { Button, SelectControl } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { useI18n } from '@wordpress/react-i18n';
import { getIpcApi } from 'src/lib/get-ipc-api';
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

	const hasEditorInstalled = installedEditors.length > 0;

	const renderEditorRecommendation = () => {
		if ( hasEditorInstalled ) {
			return null;
		}

		return (
			<p className="text-gray-500">
				{ /* translators: "Visual Studio Code" is a trademarked brand name by Microsoft. Do not translate brand names. */ }
				{ createInterpolateElement( __( 'We recommend using <a>Visual Studio Code ↗ </a>.' ), {
					a: (
						<Button
							onClick={ () => getIpcApi().openURL( 'https://code.visualstudio.com/' ) }
							variant="link"
						/>
					),
				} ) }
			</p>
		);
	};

	return (
		<SettingsFormField label={ __( 'Code editor' ) }>
			<SelectControl
				value={ value }
				onChange={ ( newValue ) => onChange( newValue as SupportedEditor ) }
				__nextHasNoMarginBottom
				__next40pxDefaultSize
				disabled={ ! value && ! hasEditorInstalled }
			>
				{ ! value && hasEditorInstalled && <option value={ '' }>{ __( 'Select' ) }</option> }

				{ ! hasEditorInstalled && (
					<option value={ '' }>{ __( 'No supported editors found' ) }</option>
				) }

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
			{ renderEditorRecommendation() }
		</SettingsFormField>
	);
};
