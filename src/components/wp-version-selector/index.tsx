import { SelectControl, Icon } from '@wordpress/components';
import { info } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useEffect } from 'react';
import { isWordPressBetaVersion } from 'common/lib/wordpress-version-utils';
import { getGroupedWordPressVersions } from 'common/lib/wp-org/version-groups';
import offlineIcon from 'src/components/offline-icon';
import { Tooltip } from 'src/components/tooltip';
import { useOffline } from 'src/hooks/use-offline';
import { cx } from 'src/lib/cx';
import { isWordPressDevVersion } from 'src/lib/version-utils';
import { useRootSelector } from 'src/stores';
import { selectDefaultWordPressVersion } from 'src/stores/provider-constants-slice';
import { useGetWordPressVersions } from 'src/stores/wordpress-versions-api';

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
};

export const WPVersionSelector = ( {
	selectedValue,
	onChange,
	errorMessage,
	disabled = false,
	extraOptions,
	fallbackOptions,
	offlineMessage,
}: WPVersionSelectorProps ) => {
	const { __ } = useI18n();
	const isOffline = useOffline();
	const defaultOfflineMessage = __( 'Changing WordPress version requires an internet connection.' );
	const message = offlineMessage || defaultOfflineMessage;
	const { data: wpVersions = [] } = useGetWordPressVersions();
	const defaultWordPressVersion = useRootSelector( selectDefaultWordPressVersion );

	// Force latest version if the user goes offline
	useEffect( () => {
		if ( isOffline ) {
			// Always force to latest when offline
			onChange( defaultWordPressVersion );
		}
	}, [ isOffline, onChange, defaultWordPressVersion ] );

	const versionsWithExtras = [ ...wpVersions ];
	extraOptions?.forEach( ( extraOption ) => {
		const alreadyExists = wpVersions.some( ( version ) => version.value === extraOption.value );
		if ( ! alreadyExists ) {
			// Convert to WordPressVersion format and add to list
			const extraVersion = {
				...extraOption,
				isBeta: isWordPressBetaVersion( extraOption.value ),
				isDevelopment: isWordPressDevVersion( extraOption.value ),
			};
			versionsWithExtras.push( extraVersion );
		}
	} );
	const groups = getGroupedWordPressVersions( versionsWithExtras );

	return (
		<label className="flex flex-1 flex-col gap-1.5 leading-4">
			<span className="font-semibold flex items-center gap-0.5">
				{ __( 'WordPress version' ) }
				{ selectedValue !== 'latest' && (
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
							{ groups.map(
								( group ) =>
									group.versions.length > 0 && (
										<optgroup key={ group.id } label={ group.label }>
											{ group.versions.map( ( { label, value } ) => (
												<option key={ value } value={ value }>
													{ label }
												</option>
											) ) }
										</optgroup>
									)
							) }
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
