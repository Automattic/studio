import { DEFAULT_WORDPRESS_VERSION, MINIMUM_WORDPRESS_VERSION } from '@studio/common/constants';
import { getAutoUpdateVersionLabel } from '@studio/common/lib/wordpress-version-labels';
import { isWordPressBetaVersion } from '@studio/common/lib/wordpress-version-utils';
import { SelectControl, Icon } from '@wordpress/components';
import { info } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useEffect } from 'react';
import offlineIcon from 'src/components/offline-icon';
import { Tooltip } from 'src/components/tooltip';
import { useOffline } from 'src/hooks/use-offline';
import { cx } from 'src/lib/cx';
import { isWordPressDevVersion } from 'src/lib/version-utils';
import { useGetWordPressVersions } from 'src/stores/wordpress-versions-api';
import { addWpVersionToList } from './add-wp-version-to-list';

type WPVersionSelectorProps = {
	selectedValue: string;
	onChange: ( version: string ) => void;
	errorMessage?: string | null;
	disabled?: boolean;
	/** Is used if you want to add a custom option to the list, for example the current version of a site */
	extraOptions?: { label: string; value: string }[];
	/** Fallback options shown when available versions couldn't be fetched */
	fallbackOptions: { label: string; value: string }[];
	/** Custom message to show when offline. If not provided, will use the default message */
	offlineMessage?: string;
	/** Version named in the auto-update option. Omit it on a pinned site. */
	autoUpdateVersion?: string;
};

export const WPVersionSelector = ( {
	selectedValue,
	onChange,
	errorMessage,
	disabled = false,
	extraOptions,
	fallbackOptions,
	offlineMessage,
	autoUpdateVersion,
}: WPVersionSelectorProps ) => {
	const { __ } = useI18n();
	const isOffline = useOffline();
	const defaultOfflineMessage = __( 'Changing WordPress version requires an internet connection.' );
	const message = offlineMessage || defaultOfflineMessage;
	const { data: wpVersions = [] } = useGetWordPressVersions( {
		minimumVersion: MINIMUM_WORDPRESS_VERSION,
	} );

	// Force latest version if the user goes offline
	useEffect( () => {
		if ( isOffline ) {
			// Always force to latest when offline
			onChange( DEFAULT_WORDPRESS_VERSION );
		}
	}, [ isOffline, onChange ] );

	let betaVersions: { label: string; value: string }[] = wpVersions.filter(
		( version ) => version.isBeta || version.isDevelopment
	);
	let stableVersions: { label: string; value: string }[] = wpVersions.filter(
		( version ) => ! version.isBeta && ! version.isDevelopment && version.value !== 'latest'
	);
	extraOptions?.forEach( ( extraOption ) => {
		const alreadyExists = wpVersions.some( ( version ) => version.value === extraOption.value );
		if ( alreadyExists ) {
			return;
		}

		if (
			isWordPressBetaVersion( extraOption.value ) ||
			isWordPressDevVersion( extraOption.value )
		) {
			betaVersions = addWpVersionToList( extraOption, betaVersions );
		} else {
			stableVersions = addWpVersionToList( extraOption, stableVersions );
		}
	} );

	return (
		<label className="flex flex-1 flex-col gap-1.5 leading-4">
			<span className="font-semibold flex items-center gap-0.5">
				{ __( 'WordPress version' ) }
				{ selectedValue !== DEFAULT_WORDPRESS_VERSION && (
					<Tooltip
						text={ __( 'WordPress Core automatic updates will be disabled for this site.' ) }
						placement="top-start"
					>
						<Icon icon={ info } size={ 16 } />
					</Tooltip>
				) }
			</span>
			<Tooltip
				disabled={ ! isOffline }
				icon={ offlineIcon }
				text={ message }
				placement="top-start"
				className="flex flex-1 flex-col"
			>
				<SelectControl
					className={ cx( errorMessage && 'error-select-control' ) }
					disabled={ disabled || isOffline }
					value={ selectedValue }
					onChange={ onChange }
					__next40pxDefaultSize
					__nextHasNoMarginBottom
				>
					{ wpVersions.length > 0 ? (
						<>
							<option key={ DEFAULT_WORDPRESS_VERSION } value={ DEFAULT_WORDPRESS_VERSION }>
								{ getAutoUpdateVersionLabel( autoUpdateVersion ) }
							</option>
							<optgroup label={ __( 'Beta & Nightly' ) }>
								{ betaVersions.map( ( { label, value } ) => (
									<option key={ value } value={ value }>
										{ label }
									</option>
								) ) }
							</optgroup>
							<optgroup label={ __( 'Stable Versions' ) }>
								{ stableVersions.map( ( { label, value } ) => (
									<option key={ value } value={ value }>
										{ label }
									</option>
								) ) }
							</optgroup>
						</>
					) : (
						fallbackOptions.map( ( { label, value } ) => (
							<option key={ value } value={ value }>
								{ label }
							</option>
						) )
					) }
				</SelectControl>
			</Tooltip>
		</label>
	);
};
