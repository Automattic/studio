/**
 * Option lists, validation and field layouts shared by the create-site form and
 * the site-settings form.
 */

import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import {
	SITE_FILE_ACCESS_ALL_FILES,
	SITE_FILE_ACCESS_SITE_DIRECTORY,
} from '@studio/common/lib/site-file-access';
import {
	getAllFilesFileAccessLabel,
	getFileAccessDescription,
	getSiteDirectoryFileAccessLabel,
} from '@studio/common/lib/site-file-access-labels';
import {
	getAutomaticUpdatesDescription,
	getAutoUpdateVersionLabel,
} from '@studio/common/lib/wordpress-version-labels';
import {
	isWordPressBetaVersion,
	isWordPressDevVersion,
} from '@studio/common/lib/wordpress-version-utils';
import {
	WP_ENVIRONMENT_TYPE_DEVELOPMENT,
	WP_ENVIRONMENT_TYPE_LOCAL,
	WP_ENVIRONMENT_TYPE_PRODUCTION,
	WP_ENVIRONMENT_TYPE_STAGING,
} from '@studio/common/lib/wp-environment-type';
import { SupportedPHPVersions } from '@studio/common/types/php-versions';
import { __ } from '@wordpress/i18n';
import { Icon } from '@wordpress/icons';
import { useId, useState } from 'react';
import { LearnHowLink } from '@/components/learn-more';
import { Button } from '@/components/ui/button';
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCertificateTrust, useTrustCertificate } from '@/data/queries/use-certificate-trust';
import styles from './style.module.css';
import type { WordPressVersion } from '@studio/common/lib/wordpress-versions';
import type { ComponentProps, ReactNode } from 'react';

export type SiteOption = {
	value: string;
	label: string;
	description?: string;
	group?: string;
	/** Renderable as the current value, but not offered. */
	hidden?: boolean;
};

export function getPhpVersionOptions(): SiteOption[] {
	return SupportedPHPVersions.map( ( version ) => ( { value: version, label: version } ) );
}

export function getEnvironmentTypeOptions(): SiteOption[] {
	return [
		{ value: WP_ENVIRONMENT_TYPE_LOCAL, label: __( 'Local' ) },
		{ value: WP_ENVIRONMENT_TYPE_DEVELOPMENT, label: __( 'Development' ) },
		{ value: WP_ENVIRONMENT_TYPE_STAGING, label: __( 'Staging' ) },
		{ value: WP_ENVIRONMENT_TYPE_PRODUCTION, label: __( 'Production' ) },
	];
}

export function getFileAccessOptions(): SiteOption[] {
	return [ SITE_FILE_ACCESS_SITE_DIRECTORY, SITE_FILE_ACCESS_ALL_FILES ].map( ( value ) => ( {
		value,
		label:
			value === SITE_FILE_ACCESS_ALL_FILES
				? getAllFilesFileAccessLabel()
				: getSiteDirectoryFileAccessLabel(),
		description: getFileAccessDescription( value ),
	} ) );
}

export function validateSiteName( name: string ): string {
	return name.trim() ? '' : __( 'Site name is required.' );
}

export function validateAdminPassword( password: string ): string {
	return password ? '' : __( 'Admin password is required.' );
}

// Numeric compare on the leading `x.y.z` part, like Classic's semver.coerce
// (`6.9-beta1` sorts with `6.9`; unparseable values sort last).
function compareWpVersions( a: string, b: string ): number {
	const parse = ( version: string ) =>
		( version.match( /^\d+(\.\d+)*/ )?.[ 0 ] ?? '' ).split( '.' ).map( Number );
	const [ aParts, bParts ] = [ parse( a ), parse( b ) ];
	for ( let i = 0; i < Math.max( aParts.length, bParts.length ); i++ ) {
		const diff = ( aParts[ i ] ?? 0 ) - ( bParts[ i ] ?? 0 );
		if ( diff !== 0 ) {
			return diff;
		}
	}
	return 0;
}

// Insert `option` into the descending-ordered `options` list (ported from the
// legacy wp-version-selector's addWpVersionToList).
function addVersionOption( option: SiteOption, options: SiteOption[] ): SiteOption[] {
	const index = options.findIndex(
		( existing ) => compareWpVersions( option.value, existing.value ) > 0
	);
	return index === -1
		? [ ...options, option ]
		: [ ...options.slice( 0, index ), option, ...options.slice( index ) ];
}

/**
 * The WordPress version choices: auto-update first, then prereleases and
 * stable releases. Undefined when there is nothing to choose from, where the
 * create form falls back to a free-text field.
 */
export function getWpVersionOptions(
	versions: WordPressVersion[] | undefined,
	{
		latestValue = DEFAULT_WORDPRESS_VERSION,
		currentVersion,
		autoUpdateVersion,
		offline = false,
	}: {
		latestValue?: string;
		/** The installed version, on an existing site. */
		currentVersion?: string;
		/** Version named in the auto-update option. Omit it on a pinned site. */
		autoUpdateVersion?: string;
		offline?: boolean;
	} = {}
): SiteOption[] | undefined {
	const offers = versions ?? [];
	// The settings form (custom `latestValue`) and the offline state always
	// offer a choice, even without a version list — only versions we can
	// actually install.
	if ( ! offers.length && latestValue === DEFAULT_WORDPRESS_VERSION && ! offline ) {
		return undefined;
	}
	const prereleaseGroup = __( 'Beta & Nightly' );
	const stableGroup = __( 'Stable Versions' );
	let prerelease: SiteOption[] = offers
		.filter( ( version ) => version.isBeta || version.isDevelopment )
		.map( ( { value, label } ) => ( { value, label, group: prereleaseGroup } ) );
	let stable: SiteOption[] = offers
		.filter(
			( version ) =>
				version.value !== DEFAULT_WORDPRESS_VERSION && ! version.isBeta && ! version.isDevelopment
		)
		.map( ( { value, label } ) => ( { value, label, group: stableGroup } ) );
	// The site's installed version may predate the fetched offers — keep it
	// selectable, sorted into the right group.
	if ( currentVersion && ! offers.some( ( version ) => version.value === currentVersion ) ) {
		const offer = { value: currentVersion, label: currentVersion };
		if ( isWordPressBetaVersion( currentVersion ) || isWordPressDevVersion( currentVersion ) ) {
			prerelease = addVersionOption( { ...offer, group: prereleaseGroup }, prerelease );
		} else {
			stable = addVersionOption( { ...offer, group: stableGroup }, stable );
		}
	}
	const options: SiteOption[] = [
		{
			value: latestValue,
			label: getAutoUpdateVersionLabel( autoUpdateVersion ),
			// Without an installed version, the description names the one the site
			// will be created with.
			description: getAutomaticUpdatesDescription( autoUpdateVersion, ! currentVersion ),
		},
		...prerelease,
		...stable,
	];
	if ( latestValue !== DEFAULT_WORDPRESS_VERSION ) {
		// The settings form maps "latest" to '' (auto-update) but falls back
		// to seeding pinned sites with DEFAULT_WORDPRESS_VERSION when their
		// installed version can't be read. Keep that seed renderable without
		// offering it.
		options.push( {
			value: DEFAULT_WORDPRESS_VERSION,
			/* translators: WordPress version option for a pinned site whose installed version Studio cannot read. */
			label: __( 'Unknown version' ),
			hidden: true,
		} );
	}
	return options;
}

// macOS can't trust the certificate for the user, so the action reveals it.
const isMacOS = /mac/i.test( navigator.platform );

// Until the browser trusts Studio's certificate, how to trust it.
export function CertificateTrustNotice() {
	const { data: isTrusted } = useCertificateTrust();
	const trustCertificate = useTrustCertificate();
	if ( isTrusted !== false ) {
		return null;
	}
	return (
		<>
			{ isMacOS
				? __(
						"Browsers will warn about HTTPS sites until you add Studio's certificate to Keychain Access and trust it."
				  )
				: __(
						"Browsers will warn about HTTPS sites until you trust Studio's certificate."
				  ) }{ ' ' }
			<LearnHowLink docsLinksKey="docsSslInStudio" />
			{ /* A span, not a div: it renders inside a paragraph. */ }
			<span className={ styles.helpAction }>
				<Button
					type="button"
					variant="outline"
					disabled={ trustCertificate.isPending }
					onClick={ () => trustCertificate.mutate() }
				>
					{ isMacOS ? __( 'Show certificate' ) : __( 'Trust certificate' ) }
				</Button>
			</span>
		</>
	);
}

const offlineIcon = (
	<svg viewBox="0 0 16 14" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path d="M14.3616 11.2468C15.339 10.682 15.9996 9.60352 15.9996 8.36597C15.9996 6.73087 14.8465 5.37347 13.3331 5.11157L13.3333 5.06597C13.3333 2.63597 11.1843 0.666016 8.5333 0.666016C7.2983 0.666016 6.17225 1.09355 5.32167 1.79598L6.36271 2.88434C6.9296 2.44576 7.67855 2.16602 8.5333 2.16602C10.4814 2.16602 11.8333 3.58458 11.8333 5.06597L11.8332 5.09497L11.8191 6.37187L13.0773 6.58967C13.8512 6.72357 14.4996 7.43967 14.4996 8.36597C14.4996 9.22043 13.9545 9.88797 13.262 10.0972L14.3616 11.2468Z" />
		<path
			fillRule="evenodd"
			clipRule="evenodd"
			d="M3.75555 11.6659H10.6867L12.458 13.5177C12.7443 13.817 13.2191 13.8276 13.5184 13.5413C13.8177 13.2549 13.8283 12.7802 13.542 12.4809L2.54198 0.980852C2.25567 0.681524 1.78091 0.670974 1.48158 0.957287C1.18226 1.2436 1.17171 1.71836 1.45802 2.01769L3.34162 3.9869C1.46387 4.18881 0 5.82609 0 7.81597C0 9.94227 1.67147 11.666 3.73333 11.666L3.75555 11.6659ZM4.79619 5.50759L3.82248 5.46777C3.793 5.46657 3.76328 5.46597 3.73333 5.46597C2.54307 5.46597 1.5 6.47427 1.5 7.81597C1.5 9.15625 2.54088 10.1638 3.72957 10.166L3.75105 10.1659H9.25193L4.79619 5.50759Z"
		/>
	</svg>
);

/** Explains why a control is disabled in a hover tooltip, which a disabled control can't show itself. */
function OfflineTooltip( { message, children }: { message: string; children: ReactNode } ) {
	// Controlled by our own hover handlers: Base UI's hover detection doesn't
	// fire over a disabled form control.
	const [ open, setOpen ] = useState( false );
	return (
		<Tooltip open={ open }>
			<TooltipTrigger
				render={
					<div onMouseEnter={ () => setOpen( true ) } onMouseLeave={ () => setOpen( false ) }>
						<div style={ { pointerEvents: 'none' } }>{ children }</div>
					</div>
				}
			/>
			<TooltipContent className={ styles.offlineTooltip } align="start">
				<Icon icon={ offlineIcon } size={ 16 } />
				{ message }
			</TooltipContent>
		</Tooltip>
	);
}

type FieldLayout = {
	label: string;
	description?: ReactNode;
	error?: string;
	orientation?: 'vertical' | 'horizontal';
};

function useDescription( { description, error }: Pick< FieldLayout, 'description' | 'error' > ) {
	const id = useId();
	const descriptionId = `${ id }-description`;
	return {
		id,
		describedBy: description || error ? descriptionId : undefined,
		element: ( description || error ) && (
			<FieldDescription id={ descriptionId } error={ error }>
				{ description }
			</FieldDescription>
		),
	};
}

function FieldLayoutRow( {
	id,
	label,
	description,
	orientation = 'vertical',
	disabled,
	children,
}: Omit< FieldLayout, 'description' | 'error' > & {
	id: string;
	description: ReactNode;
	disabled?: boolean;
	children: ReactNode;
} ) {
	if ( orientation === 'vertical' ) {
		return (
			<Field data-disabled={ disabled || undefined }>
				<FieldLabel htmlFor={ id }>{ label }</FieldLabel>
				{ children }
				{ description }
			</Field>
		);
	}
	return (
		<Field orientation="horizontal" data-disabled={ disabled || undefined }>
			<FieldContent>
				<FieldLabel htmlFor={ id }>{ label }</FieldLabel>
				{ description }
			</FieldContent>
			{ children }
		</Field>
	);
}

export function TextField( {
	label,
	description,
	error,
	orientation,
	action,
	...props
}: FieldLayout &
	Omit< ComponentProps< typeof Input >, 'id' | 'aria-describedby' | 'aria-invalid' > & {
		/** Buttons beside the input. */
		action?: ReactNode;
	} ) {
	const { id, describedBy, element } = useDescription( { description, error } );
	const input = (
		<Input
			id={ id }
			aria-describedby={ describedBy }
			aria-invalid={ error ? true : undefined }
			{ ...props }
		/>
	);
	return (
		<FieldLayoutRow
			id={ id }
			label={ label }
			description={ element }
			orientation={ orientation }
			disabled={ props.disabled }
		>
			{ action || orientation === 'horizontal' ? (
				<div className={ styles.textControl }>
					{ input }
					{ action }
				</div>
			) : (
				input
			) }
		</FieldLayoutRow>
	);
}

/** A select over `options`, grouped by their `group`. */
export function SiteSelect( {
	value,
	options,
	disabled,
	disabledReason,
	onChange,
	...props
}: Omit< ComponentProps< typeof SelectTrigger >, 'value' | 'onChange' | 'children' > & {
	value: string;
	options: SiteOption[];
	disabled?: boolean;
	/** Shown in a tooltip over the disabled control. */
	disabledReason?: string;
	onChange: ( value: string ) => void;
} ) {
	const offered = options.filter( ( option ) => ! option.hidden );
	const groups = Array.from( new Set( offered.map( ( option ) => option.group ) ) );
	const select = (
		<Select
			items={ options }
			value={ value }
			disabled={ disabled }
			onValueChange={ ( next ) => {
				if ( next !== null ) onChange( next );
			} }
		>
			<SelectTrigger { ...props }>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{ groups.map( ( group ) => (
					<SelectGroup key={ group ?? '' }>
						{ group && <SelectLabel>{ group }</SelectLabel> }
						{ offered
							.filter( ( option ) => option.group === group )
							.map( ( option ) => (
								<SelectItem
									key={ option.value }
									value={ option.value }
									description={ option.description }
								>
									{ option.label }
								</SelectItem>
							) ) }
					</SelectGroup>
				) ) }
			</SelectContent>
		</Select>
	);
	return disabled && disabledReason ? (
		<OfflineTooltip message={ disabledReason }>{ select }</OfflineTooltip>
	) : (
		select
	);
}

export function SelectField( {
	label,
	description,
	error,
	orientation = 'horizontal',
	disabled,
	...props
}: FieldLayout & Omit< ComponentProps< typeof SiteSelect >, 'id' | 'aria-describedby' > ) {
	const { id, describedBy, element } = useDescription( { description, error } );
	return (
		<FieldLayoutRow
			id={ id }
			label={ label }
			description={ element }
			orientation={ orientation }
			disabled={ disabled }
		>
			<SiteSelect id={ id } aria-describedby={ describedBy } disabled={ disabled } { ...props } />
		</FieldLayoutRow>
	);
}

export function ToggleField( {
	label,
	description,
	error,
	checked,
	disabled,
	onChange,
}: Omit< FieldLayout, 'orientation' > & {
	checked: boolean;
	disabled?: boolean;
	onChange: ( checked: boolean ) => void;
} ) {
	const { id, describedBy, element } = useDescription( { description, error } );
	return (
		<FieldLayoutRow
			id={ id }
			label={ label }
			description={ element }
			orientation="horizontal"
			disabled={ disabled }
		>
			<Switch
				id={ id }
				aria-describedby={ describedBy }
				aria-invalid={ error ? true : undefined }
				checked={ checked }
				disabled={ disabled }
				onCheckedChange={ ( next ) => onChange( next ) }
			/>
		</FieldLayoutRow>
	);
}
