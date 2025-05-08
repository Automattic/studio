import { Button, SelectControl } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren } from 'react';
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
	disabled?: boolean;
}

export const EditorPicker = ( { value, onChange, disabled }: EditorPickerProps ) => {
	const { __ } = useI18n();
	const { installedEditors, uninstalledEditors } = useGetInstalledAppsQuery( undefined, {
		selectFromResult: ( result ) => ( {
			installedEditors: selectInstalledEditors( result.data ),
			uninstalledEditors: selectUninstalledEditors( result.data ),
		} ),
	} );

	const ReadMoreLink = ( props: PropsWithChildren ) => {
		return (
			<Button
				onClick={ () =>
					getIpcApi().openURL(
						'https://developer.wordpress.com/docs/developer-tools/studio/sites/#site-overview'
					)
				}
				variant="link"
			>
				{ props.children } ↗
			</Button>
		);
	};

	const renderHelp = () => {
		if ( installedEditors.length > 0 ) {
			return null;
		}

		return (
			<p className="text-gray-500">
				{ createInterpolateElement(
					__( 'You can find a list of supported code editors <a>here</a>.' ),
					{
						a: <ReadMoreLink />,
					}
				) }
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
				disabled={ disabled }
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
			{ renderHelp() }
		</SettingsFormField>
	);
};
