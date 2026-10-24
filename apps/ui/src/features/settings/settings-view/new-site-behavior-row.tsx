import { __ } from '@wordpress/i18n';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { SettingsRow, SettingsSelect } from './rows';
import type { NewSiteBehavior } from '@studio/common/lib/user-settings/preferences';

export function NewSiteBehaviorRow() {
	const { data } = useUserPreferences();
	const save = useSaveUserPreferences();
	return (
		<SettingsRow title={ __( 'When adding a site' ) }>
			<SettingsSelect< NewSiteBehavior >
				label={ __( 'When adding a site' ) }
				value={ data?.newSiteBehavior ?? 'choose' }
				options={ [
					{ value: 'choose', label: __( 'Choose a starting point' ) },
					{ value: 'blank', label: __( 'Start with a blank site' ) },
				] }
				onChange={ ( newSiteBehavior ) => save.mutate( { newSiteBehavior } ) }
			/>
		</SettingsRow>
	);
}
