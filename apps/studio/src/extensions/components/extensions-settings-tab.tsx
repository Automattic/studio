import { CheckboxControl, Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { FormEvent, useState } from 'react';
import Button from 'src/components/button';
import { FormPathInputComponent } from 'src/components/form-path-input';
import TextControl from 'src/components/text-control';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { SettingsFormField } from 'src/modules/user-settings/components/settings-form-field';
import {
	useGetStudioExtensionsQuery,
	useInstallStudioExtensionMutation,
	useInstallStudioExtensionFromPathMutation,
	useInstallStudioExtensionFromUrlMutation,
	useSetStudioExtensionEnabledMutation,
	useUninstallStudioExtensionMutation,
} from 'src/stores/installed-apps-api';
import type { StudioExtensionListItem } from '../types';

type InstallSourceMode = 'directory' | 'git';

function getInstallErrorMessage( error: unknown ): string {
	if ( error instanceof Error ) {
		return error.message;
	}
	if ( typeof error === 'object' && error && 'data' in error ) {
		const data = error.data;
		if ( typeof data === 'string' ) {
			return data;
		}
	}
	if ( typeof error === 'object' && error && 'error' in error ) {
		const message = error.error;
		if ( typeof message === 'string' ) {
			return message;
		}
	}
	if ( typeof error === 'object' && error && 'message' in error ) {
		const message = error.message;
		if ( typeof message === 'string' ) {
			return message;
		}
	}
	return __( 'Unable to install extension.' );
}

function getExtensionStatusLabel( extension: StudioExtensionListItem ): string {
	if ( extension.status === 'unsupported' ) {
		return __( 'Installed, unsupported' );
	}
	if ( extension.status === 'missing' ) {
		return __( 'Missing from disk' );
	}
	if ( extension.installed ) {
		return extension.enabled ? __( 'Enabled' ) : __( 'Installed' );
	}
	return extension.kind === 'built-in' ? __( 'Available' ) : __( 'Not installed' );
}

function getExtensionActionLabel( extension: StudioExtensionListItem ): string {
	if ( extension.status === 'missing' ) {
		return __( 'Remove' );
	}
	return extension.installed ? __( 'Uninstall' ) : __( 'Install' );
}

function shouldUninstallExtension( extension: StudioExtensionListItem ): boolean {
	return extension.installed || extension.status === 'missing';
}

export function ExtensionsSettingsTab() {
	const { data: extensions = [], isLoading } = useGetStudioExtensionsQuery();
	const [ installExtension, installState ] = useInstallStudioExtensionMutation();
	const [ installExtensionFromPath, installFromPathState ] =
		useInstallStudioExtensionFromPathMutation();
	const [ installExtensionFromUrl, installFromUrlState ] =
		useInstallStudioExtensionFromUrlMutation();
	const [ uninstallExtension, uninstallState ] = useUninstallStudioExtensionMutation();
	const [ setExtensionEnabled, enabledState ] = useSetStudioExtensionEnabledMutation();
	const [ installMode, setInstallMode ] = useState< InstallSourceMode >( 'git' );
	const [ gitSourceUrl, setGitSourceUrl ] = useState( '' );
	const [ directoryPath, setDirectoryPath ] = useState( '' );
	const [ installError, setInstallError ] = useState< string | null >( null );
	const isSaving =
		installState.isLoading ||
		installFromPathState.isLoading ||
		installFromUrlState.isLoading ||
		uninstallState.isLoading ||
		enabledState.isLoading;
	const installSourceValue = installMode === 'git' ? gitSourceUrl : directoryPath;
	const selectedDirectoryLabel = directoryPath || __( 'Choose extension folder…' );

	async function handleChooseDirectory() {
		const response = await getIpcApi().showOpenFolderDialog(
			__( 'Select extension folder' ),
			directoryPath
		);
		if ( response?.path ) {
			setDirectoryPath( response.path );
			setInstallError( null );
		}
	}

	async function handleInstallFromSource( event: FormEvent< HTMLFormElement > ) {
		event.preventDefault();
		const trimmedSource = installSourceValue.trim();
		if ( ! trimmedSource ) {
			return;
		}
		setInstallError( null );
		try {
			if ( installMode === 'git' ) {
				await installExtensionFromUrl( trimmedSource ).unwrap();
				setGitSourceUrl( '' );
			} else {
				await installExtensionFromPath( trimmedSource ).unwrap();
				setDirectoryPath( '' );
			}
		} catch ( error ) {
			setInstallError( getInstallErrorMessage( error ) );
		}
	}

	if ( isLoading ) {
		return (
			<div className="flex items-center gap-2 text-sm text-frame-text-secondary">
				<Spinner className="!m-0" />
				{ __( 'Loading extensions…' ) }
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<form
				className="rounded-sm border border-frame-border bg-frame-surface p-4"
				onSubmit={ handleInstallFromSource }
			>
				<div
					className="mb-4 inline-flex rounded-sm border border-frame-border bg-frame-bg p-0.5"
					role="tablist"
					aria-label={ __( 'Extension install source' ) }
				>
					{ (
						[
							[ 'git', __( 'Git URL' ) ],
							[ 'directory', __( 'Local directory' ) ],
						] as const
					 ).map( ( [ mode, label ] ) => {
						const isSelected = installMode === mode;
						return (
							<button
								key={ mode }
								type="button"
								role="tab"
								aria-selected={ isSelected }
								className={ cx(
									'rounded-[2px] px-3 py-1.5 text-sm',
									'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme',
									isSelected
										? 'bg-frame-surface text-frame-text shadow-[0_0_0_1px_var(--color-frame-border)]'
										: 'text-frame-text-secondary hover:text-frame-text'
								) }
								onClick={ () => {
									setInstallMode( mode );
									setInstallError( null );
								} }
							>
								{ label }
							</button>
						);
					} ) }
				</div>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-end">
					<div className="min-w-0 flex-1">
						{ installMode === 'git' ? (
							<TextControl
								label={ __( 'Git URL' ) }
								value={ gitSourceUrl }
								placeholder="https://github.com/example/studio-extension"
								disabled={ isSaving }
								onChange={ setGitSourceUrl }
							/>
						) : (
							<SettingsFormField label={ __( 'Local directory' ) }>
								<FormPathInputComponent
									id="extension-directory-path"
									value={ selectedDirectoryLabel }
									onClick={ handleChooseDirectory }
									disabled={ isSaving }
								/>
							</SettingsFormField>
						) }
					</div>
					<Button
						type="submit"
						variant="primary"
						disabled={ isSaving || installSourceValue.trim() === '' }
					>
						{ __( 'Install' ) }
					</Button>
				</div>
				{ installError && <p className="mt-3 text-sm text-frame-error">{ installError }</p> }
			</form>
			{ extensions.map( ( extension ) => (
				<section
					key={ extension.id }
					className="rounded-sm border border-frame-border bg-frame-surface p-4"
				>
					<div className="flex items-start justify-between gap-5">
						<div className="min-w-0">
							<h2 className="a8c-subtitle-small">{ extension.name }</h2>
							<p className="mt-1 text-sm text-frame-text-secondary">{ extension.description }</p>
							<p className="mt-2 text-xs text-frame-text-secondary">
								{ extension.kind === 'built-in' ? __( 'Built-in extension' ) : __( 'Extension' ) } ·{ ' ' }
								{ extension.version } · { getExtensionStatusLabel( extension ) }
							</p>
							{ extension.sourceUrl && (
								<p className="mt-2 break-all text-xs text-frame-text-secondary">
									{ extension.sourceUrl }
								</p>
							) }
							{ extension.installedPath && (
								<p className="mt-1 break-all text-xs text-frame-text-secondary">
									{ extension.installedPath }
								</p>
							) }
						</div>
						<Button
							variant={ shouldUninstallExtension( extension ) ? 'secondary' : 'primary' }
							disabled={
								isSaving ||
								( ! extension.installed &&
									! [ 'available', 'missing' ].includes( extension.status ) )
							}
							onClick={ () =>
								shouldUninstallExtension( extension )
									? uninstallExtension( extension.id )
									: installExtension( extension.id )
							}
						>
							{ getExtensionActionLabel( extension ) }
						</Button>
					</div>
					<div className="mt-4">
						<CheckboxControl
							label={ __( 'Enabled' ) }
							checked={ extension.enabled }
							disabled={ isSaving || ! extension.installed || ! extension.isSupported }
							onChange={ ( checked ) =>
								setExtensionEnabled( { extensionId: extension.id, enabled: checked } )
							}
						/>
					</div>
				</section>
			) ) }
		</div>
	);
}
