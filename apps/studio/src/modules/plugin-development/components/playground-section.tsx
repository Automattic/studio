import * as Sentry from '@sentry/electron/renderer';
import { DEFAULT_PHP_VERSION, DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import {
	SupportedPHPVersions,
	isSupportedPHPVersion,
	type SupportedPHPVersion,
} from '@studio/common/types/php-versions';
import { SelectControl } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { external, globe, reset } from '@wordpress/icons';
import { useEffect, useMemo, useState } from 'react';
import Button from 'src/components/button';
import { WPVersionSelector } from 'src/components/wp-version-selector';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useDevelopmentProjects } from '../hooks/use-development-projects';
import { MetadataRow } from './shared-ui';
import type { DevelopmentProject } from '@studio/common/types/publishing';

function getDefaultProjectPhpVersion( project: DevelopmentProject ): SupportedPHPVersion {
	const requestedVersion = project.info?.requiresPhp;
	return isSupportedPHPVersion( requestedVersion ) ? requestedVersion : DEFAULT_PHP_VERSION;
}

export function PlaygroundSection( {
	project,
	isBlocked,
	isCompact = false,
}: {
	project: DevelopmentProject;
	isBlocked: boolean;
	isCompact?: boolean;
} ) {
	const { startProjectPlayground, startingPlaygroundProjectId } = useDevelopmentProjects();
	const ipcApi = getIpcApi();
	const [ wpVersion, setWpVersion ] = useState< string >( DEFAULT_WORDPRESS_VERSION );
	const [ phpVersion, setPhpVersion ] = useState< SupportedPHPVersion >(
		getDefaultProjectPhpVersion( project )
	);
	const [ playground, setPlayground ] = useState< {
		siteId: string;
		siteName: string;
		sitePath: string;
		url?: string;
	} | null >( null );
	const [ errorMessage, setErrorMessage ] = useState< string | null >( null );
	const isStartingPlayground = startingPlaygroundProjectId === project.id;
	const requiredPhpVersion = project.info?.requiresPhp;
	const linkedSiteId = playground?.siteId || project.linkedSiteId;
	const primaryActionLabel = linkedSiteId ? __( 'Open Playground' ) : __( 'Start Playground' );
	const extraWpOptions = useMemo(
		() =>
			[ project.info?.testedUpTo, project.info?.requiresAtLeast ]
				.filter( ( value ): value is string => Boolean( value && value !== 'latest' ) )
				.map( ( value ) => ( { label: value, value } ) ),
		[ project.info?.requiresAtLeast, project.info?.testedUpTo ]
	);

	useEffect( () => {
		setPhpVersion(
			isSupportedPHPVersion( requiredPhpVersion ) ? requiredPhpVersion : DEFAULT_PHP_VERSION
		);
	}, [ project.id, requiredPhpVersion ] );

	const handleStart = async ( resetPlayground = false ) => {
		setErrorMessage( null );
		try {
			const result = await startProjectPlayground( project.id, {
				wpVersion,
				phpVersion,
				reset: resetPlayground,
			} );
			setPlayground( {
				siteId: result.siteId,
				siteName: result.siteName,
				sitePath: result.sitePath,
				url: result.url,
			} );
			ipcApi.openSiteURL( result.siteId );
		} catch ( error ) {
			Sentry.captureException( error );
			setErrorMessage( error instanceof Error ? error.message : String( error ) );
		}
	};

	return (
		<section>
			<h2 className="a8c-subtitle-small mb-3">{ __( 'Playground' ) }</h2>
			<div className="rounded-sm border border-frame-border bg-frame-surface p-4 flex flex-col gap-4">
				<div className={ cx( 'grid grid-cols-1 gap-4', ! isCompact && 'md:grid-cols-2' ) }>
					<WPVersionSelector
						selectedValue={ wpVersion }
						onChange={ setWpVersion }
						disabled={ isBlocked || isStartingPlayground }
						extraOptions={ extraWpOptions }
						fallbackOptions={ [
							{
								label: __( 'latest' ),
								value: DEFAULT_WORDPRESS_VERSION,
							},
						] }
					/>
					<label className="flex flex-1 flex-col gap-1.5 leading-4">
						<span className="font-semibold">{ __( 'PHP version' ) }</span>
						<SelectControl< SupportedPHPVersion >
							value={ phpVersion }
							onChange={ setPhpVersion }
							disabled={ isBlocked || isStartingPlayground }
							__next40pxDefaultSize
							__nextHasNoMarginBottom
						>
							{ SupportedPHPVersions.map( ( version ) => (
								<option key={ version } value={ version }>
									{ version }
								</option>
							) ) }
						</SelectControl>
					</label>
				</div>

				<div className="flex flex-wrap gap-2">
					<Button
						variant="primary"
						icon={ globe }
						iconSize={ 18 }
						disabled={ isBlocked || isStartingPlayground }
						onClick={ () => handleStart( false ) }
					>
						{ isStartingPlayground ? __( 'Starting…' ) : primaryActionLabel }
					</Button>
					<Button
						variant="secondary"
						icon={ reset }
						iconSize={ 18 }
						disabled={ isBlocked || isStartingPlayground || ! linkedSiteId }
						onClick={ () => handleStart( true ) }
					>
						{ __( 'Reset' ) }
					</Button>
					<Button
						variant="secondary"
						icon={ external }
						iconSize={ 18 }
						disabled={ ! linkedSiteId }
						onClick={ () => linkedSiteId && ipcApi.openSiteURL( linkedSiteId ) }
					>
						{ __( 'Open' ) }
					</Button>
				</div>

				<div className={ cx( 'grid grid-cols-1 gap-4', ! isCompact && 'md:grid-cols-2' ) }>
					<MetadataRow label={ __( 'Site' ) } value={ playground?.siteName } />
					<MetadataRow label={ __( 'Folder' ) } value={ playground?.sitePath } />
					<MetadataRow label={ __( 'URL' ) } value={ playground?.url } />
					<MetadataRow
						label={ __( 'Runtime' ) }
						value={ sprintf(
							// translators: %1$s is a WordPress version, %2$s is a PHP version.
							__( 'WordPress %1$s, PHP %2$s' ),
							wpVersion,
							phpVersion
						) }
					/>
				</div>

				{ errorMessage && (
					<div className="text-sm text-frame-error">
						{ sprintf(
							// translators: %s is an error message.
							__( 'Could not start Playground: %s' ),
							errorMessage
						) }
					</div>
				) }
			</div>
		</section>
	);
}
