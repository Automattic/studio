import { SelectControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { SettingsFormField } from './settings-form-field';
import type { QuitSitesBehavior } from 'src/storage/user-data';

interface QuitSitesBehaviorPickerProps {
	value: QuitSitesBehavior | undefined;
	onChange: ( value: QuitSitesBehavior | undefined ) => void;
}

export const QuitSitesBehaviorPicker = ( { value, onChange }: QuitSitesBehaviorPickerProps ) => {
	const { __ } = useI18n();

	return (
		<SettingsFormField label={ __( 'When quitting with running sites' ) }>
			<SelectControl< QuitSitesBehavior | '' >
				value={ value ?? '' }
				onChange={ ( newValue ) => onChange( newValue || undefined ) }
				options={ [
					{ value: '', label: __( 'Ask every time' ) },
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
