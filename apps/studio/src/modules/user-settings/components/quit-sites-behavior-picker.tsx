import { SelectControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { QuitSitesBehaviorSetting } from 'src/storage/storage-types';
import { SettingsFormField } from './settings-form-field';

interface QuitSitesBehaviorPickerProps {
	value: QuitSitesBehaviorSetting;
	onChange: ( value: QuitSitesBehaviorSetting ) => void;
}

export const QuitSitesBehaviorPicker = ( { value, onChange }: QuitSitesBehaviorPickerProps ) => {
	const { __ } = useI18n();
	return (
		<SettingsFormField label={ __( 'When quitting with running sites' ) }>
			<SelectControl< QuitSitesBehaviorSetting >
				value={ value }
				onChange={ ( newValue ) => onChange( newValue ) }
				options={ [
					{ value: 'ask', label: __( 'Ask every time' ) },
					{ value: 'leave-running', label: __( 'Keep sites running' ) },
					{ value: 'stop-and-auto-start', label: __( 'Stop, restart on next launch' ) },
					{ value: 'stop', label: __( 'Stop sites' ) },
				] }
				__nextHasNoMarginBottom
				__next40pxDefaultSize
				data-testid="quit-sites-behavior-select"
			/>
		</SettingsFormField>
	);
};
