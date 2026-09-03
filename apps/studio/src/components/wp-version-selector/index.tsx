import { DEFAULT_WORDPRESS_VERSION, MINIMUM_WORDPRESS_VERSION } from '@studio/common/constants';
import {
	getAutomaticUpdatesDescription,
	getAutomaticUpdatesLabel,
	getSelectAVersionLabel,
} from '@studio/common/lib/wordpress-version-labels';
import { isWordPressBetaVersion } from '@studio/common/lib/wordpress-version-utils';
import { SelectControl, Icon } from '@wordpress/components';
import { info } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useEffect, useId } from 'react';
import offlineIcon from 'src/components/offline-icon';
import { Tooltip } from 'src/components/tooltip';
import { useOffline } from 'src/hooks/use-offline';
import { cx } from 'src/lib/cx';
import { getLatestStableWpVersion, isWordPressDevVersion } from 'src/lib/version-utils';
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
	// Unique per instance, so two selectors on one screen keep their own radio
	// group and their own label/description associations.
	const modeControlName = useId();
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

	// Without a fetched version list there is nothing to pin to, so the control
	// degrades to a plain dropdown over `fallbackOptions`.
	const usesUpdateMode = wpVersions.length > 0;
	const automaticUpdates = selectedValue === DEFAULT_WORDPRESS_VERSION;
	// Leaving auto-update lands on the version the site already runs, or on the
	// newest stable release for a site that doesn't exist yet.
	const pinnedFallback =
		autoUpdateVersion || getLatestStableWpVersion( wpVersions ) || DEFAULT_WORDPRESS_VERSION;

	// A function, not an element: auto-update is the default in both forms, and
	// there the dropdown is never rendered.
	const renderVersionSelect = () => (
		<SelectControl
			className={ cx( errorMessage && 'error-select-control' ) }
			// In update mode the "Select a version" radio introduces the dropdown
			// visually, but it still needs its own accessible name. Outside it, the
			// wrapping <label> already names the control.
			label={ usesUpdateMode ? __( 'Version' ) : undefined }
			hideLabelFromVision={ usesUpdateMode }
			disabled={ disabled || isOffline }
			// While "Automatic updates" is chosen the value is the mode, not a
			// version, so preview the version the radio below would pin to.
			value={ usesUpdateMode && automaticUpdates ? pinnedFallback : selectedValue }
			onChange={ onChange }
			__next40pxDefaultSize
			__nextHasNoMarginBottom
		>
			{ usesUpdateMode ? (
				<>
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
	);

	if ( usesUpdateMode ) {
		const automaticId = `${ modeControlName }-automatic`;
		const automaticDescriptionId = `${ automaticId }-description`;
		const pinnedId = `${ modeControlName }-pinned`;
		return (
			<div
				role="group"
				aria-label={ __( 'WordPress version' ) }
				className="flex flex-1 flex-col gap-1.5 leading-4"
			>
				<span className="font-semibold">{ __( 'WordPress version' ) }</span>
				<Tooltip
					disabled={ ! isOffline }
					icon={ offlineIcon }
					text={ message }
					placement="top-start"
					className="flex flex-1 flex-col"
				>
					<div className="components-radio-control">
						<div className="components-radio-control__option">
							<input
								id={ automaticId }
								className="components-radio-control__input"
								type="radio"
								name={ modeControlName }
								checked={ automaticUpdates }
								disabled={ disabled || isOffline }
								// Forms mode announces only the radio's label and
								// description, so the description has to be named here.
								aria-describedby={ automaticDescriptionId }
								onChange={ () => onChange( DEFAULT_WORDPRESS_VERSION ) }
							/>
							<label htmlFor={ automaticId } className="components-radio-control__label">
								{ getAutomaticUpdatesLabel() }
							</label>
							<p
								id={ automaticDescriptionId }
								className="components-radio-control__option-description"
							>
								{ /* Naming a version on a pinned site would read as if
								     auto-update were keeping it there. */ }
								{ getAutomaticUpdatesDescription(
									automaticUpdates ? autoUpdateVersion : undefined
								) }
							</p>
						</div>
						<div className="components-radio-control__option">
							<input
								id={ pinnedId }
								className="components-radio-control__input"
								type="radio"
								name={ modeControlName }
								checked={ ! automaticUpdates }
								disabled={ disabled || isOffline }
								onChange={ () => onChange( pinnedFallback ) }
							/>
							<label htmlFor={ pinnedId } className="components-radio-control__label">
								{ getSelectAVersionLabel() }
							</label>
							<div className="components-radio-control__option-description max-w-[180px]">
								{ renderVersionSelect() }
							</div>
						</div>
					</div>
				</Tooltip>
			</div>
		);
	}

	return (
		<label className="flex flex-1 flex-col gap-1.5 leading-4">
			<span className="font-semibold flex items-center gap-0.5">
				{ __( 'WordPress version' ) }
				{ ! automaticUpdates && (
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
				{ renderVersionSelect() }
			</Tooltip>
		</label>
	);
};
