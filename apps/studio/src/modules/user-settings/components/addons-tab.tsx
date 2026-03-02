import { FormToggle } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useEffect, useState } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getBundledAddons } from 'src/modules/addons/registry';
import { SettingsFormField } from 'src/modules/user-settings/components/settings-form-field';

export function AddonsTab() {
	const { __ } = useI18n();
	const addons = getBundledAddons();
	const [ enabledIds, setEnabledIds ] = useState< string[] >( [] );
	const [ isLoading, setIsLoading ] = useState( true );

	useEffect( () => {
		void getIpcApi()
			.getEnabledAddonIds()
			.then( ( ids ) => setEnabledIds( ids ) )
			.finally( () => setIsLoading( false ) );
	}, [] );

	const handleToggle = async ( addonId: string, enabled: boolean ) => {
		const next = enabled
			? [ ...enabledIds, addonId ]
			: enabledIds.filter( ( id ) => id !== addonId );
		setEnabledIds( next );
		await getIpcApi().saveEnabledAddonIds( next );
	};

	if ( isLoading ) {
		return null;
	}

	if ( addons.length === 0 ) {
		return <p className="text-[13px] text-a8c-gray-50">{ __( 'No add-ons are installed.' ) }</p>;
	}

	return (
		<>
			{ addons.map( ( addon ) => {
				const isEnabled = enabledIds.includes( addon.manifest.id );
				const toggleId = `addon-toggle-${ addon.manifest.id }`;
				return (
					<SettingsFormField key={ addon.manifest.id } label={ addon.manifest.name }>
						<div className="flex justify-start items-center gap-2">
							<FormToggle
								id={ toggleId }
								checked={ isEnabled }
								onChange={ ( e ) => {
									void handleToggle( addon.manifest.id, e.target.checked );
								} }
							/>
							<label htmlFor={ toggleId } className="text-[13px] text-gray-700">
								{ addon.manifest.description }
							</label>
						</div>
					</SettingsFormField>
				);
			} ) }
		</>
	);
}
