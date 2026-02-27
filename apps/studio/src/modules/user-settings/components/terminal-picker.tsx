import { SelectControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { SupportedTerminal, getTerminalName } from 'src/modules/user-settings/lib/terminal';
import {
	useGetInstalledAppsQuery,
	selectInstalledTerminals,
	selectUninstalledTerminals,
} from 'src/stores/installed-apps-api';
import { SettingsFormField } from './settings-form-field';

interface TerminalPickerProps {
	value: SupportedTerminal;
	onChange: ( value: SupportedTerminal ) => void;
}

export const TerminalPicker = ( { value, onChange }: TerminalPickerProps ) => {
	const { __ } = useI18n();
	const { installedTerminals, uninstalledTerminals } = useGetInstalledAppsQuery( undefined, {
		selectFromResult: ( result ) => ( {
			installedTerminals: selectInstalledTerminals( result.data ),
			uninstalledTerminals: selectUninstalledTerminals( result.data ),
		} ),
	} );

	return (
		<SettingsFormField label={ __( 'Terminal application' ) }>
			<SelectControl< SupportedTerminal >
				value={ value }
				onChange={ ( newValue ) => onChange( newValue ) }
				__nextHasNoMarginBottom
				__next40pxDefaultSize
			>
				<optgroup label={ __( 'Available terminals' ) }>
					{ installedTerminals.map( ( [ terminal ] ) => (
						<option key={ terminal } value={ terminal }>
							{ getTerminalName( terminal ) }
						</option>
					) ) }
				</optgroup>
				{ uninstalledTerminals.length > 0 && (
					<optgroup label={ __( 'Not installed' ) }>
						{ uninstalledTerminals.map( ( [ terminal ] ) => (
							<option key={ terminal } value={ terminal } disabled>
								{ getTerminalName( terminal ) }
							</option>
						) ) }
					</optgroup>
				) }
			</SelectControl>
		</SettingsFormField>
	);
};
