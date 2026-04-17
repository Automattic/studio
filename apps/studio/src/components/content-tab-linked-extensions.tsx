import * as Sentry from '@sentry/electron/renderer';
import { Button, DropdownMenu, MenuGroup, MenuItem, Spinner } from '@wordpress/components';
import { __ as translate } from '@wordpress/i18n';
import { archive, code, moreVertical, preformatted } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import { isWindows } from 'src/lib/app-globals';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { supportedEditorConfig } from 'src/modules/user-settings/lib/editor';
import { getTerminalName } from 'src/modules/user-settings/lib/terminal';
import { useGetUserEditorQuery, useGetUserTerminalQuery } from 'src/stores/installed-apps-api';
import {
	useGetLinkedPluginsQuery,
	useGetLinkedThemesQuery,
	useLinkPluginMutation,
	useLinkThemeMutation,
	useUnlinkPluginMutation,
	useUnlinkThemeMutation,
} from 'src/stores/linked-extensions-api';
import type { LinkedExtension } from 'src/stores/linked-extensions-api';

interface ContentTabLinkedExtensionsProps {
	selectedSite: SiteDetails;
}

type Kind = 'plugin' | 'theme';

function extractErrorMessage( error: unknown ): string {
	if ( error instanceof Error ) {
		return error.message;
	}
	if ( typeof error === 'object' && error !== null ) {
		const err = error as { message?: unknown; error?: unknown; data?: unknown };
		if ( typeof err.message === 'string' ) {
			return err.message;
		}
		if ( typeof err.error === 'string' ) {
			return err.error;
		}
		if ( typeof err.data === 'string' ) {
			return err.data;
		}
	}
	if ( typeof error === 'string' ) {
		return error;
	}
	try {
		return JSON.stringify( error );
	} catch {
		return String( error );
	}
}

interface ExtensionListProps {
	kind: Kind;
	siteId: string;
	heading: string;
	emptyHelp: string;
	addLabel: string;
	dialogTitle: string;
	items: LinkedExtension[] | undefined;
	isLoading: boolean;
	onAdd: () => void;
	onRemove: ( name: string ) => void;
	pendingRemove: string | null;
	isAdding: boolean;
}

function OpenInMenu( { sourcePath }: { sourcePath: string } ) {
	const { __ } = useI18n();
	const { data: editor } = useGetUserEditorQuery();
	const { data: terminal } = useGetUserTerminalQuery();

	const fileManagerLabel = isWindows()
		? // translators: name of app used to navigate files and folders on Windows
		  __( 'File Explorer' )
		: // translators: name of app used to navigate files and folders on macOS
		  __( 'Finder' );

	const editorConfig = editor ? supportedEditorConfig[ editor ] : undefined;
	const terminalName = getTerminalName( terminal );

	return (
		<DropdownMenu
			icon={ moreVertical }
			label={ __( 'Open in…' ) }
			className="p-1 flex items-center"
		>
			{ ( { onClose }: { onClose: () => void } ) => (
				<MenuGroup className="w-48 overflow-hidden">
					<MenuItem
						icon={ archive }
						onClick={ () => {
							getIpcApi().openLocalPath( sourcePath );
							onClose();
						} }
					>
						<span>{ fileManagerLabel }</span>
					</MenuItem>
					{ editor && editorConfig && (
						<MenuItem
							icon={ code }
							onClick={ async () => {
								onClose();
								try {
									await getIpcApi().openAppAtPath( editor, sourcePath );
								} catch ( error ) {
									Sentry.captureException( error );
									getIpcApi().showErrorMessageBox( {
										title: translate( 'Could not open editor' ),
										message: extractErrorMessage( error ),
									} );
								}
							} }
						>
							<span>{ editorConfig.label }</span>
						</MenuItem>
					) }
					<MenuItem
						icon={ preformatted }
						onClick={ async () => {
							onClose();
							try {
								await getIpcApi().openTerminalAtPath( sourcePath );
							} catch ( error ) {
								Sentry.captureException( error );
								getIpcApi().showErrorMessageBox( {
									title: translate( 'Could not open the terminal' ),
									message: extractErrorMessage( error ),
								} );
							}
						} }
					>
						<span>{ terminalName }</span>
					</MenuItem>
				</MenuGroup>
			) }
		</DropdownMenu>
	);
}

function ExtensionList( {
	heading,
	emptyHelp,
	addLabel,
	items,
	isLoading,
	onAdd,
	onRemove,
	pendingRemove,
	isAdding,
}: ExtensionListProps ) {
	const { __ } = useI18n();

	return (
		<section className="mb-10">
			<div className="flex items-center justify-between mb-3">
				<h2 className="a8c-subtitle-small">{ heading }</h2>
				<Button variant="secondary" onClick={ onAdd } disabled={ isAdding }>
					{ isAdding ? <Spinner /> : addLabel }
				</Button>
			</div>

			{ isLoading && (
				<div className="text-frame-text-secondary">
					<Spinner /> { __( 'Loading…' ) }
				</div>
			) }

			{ ! isLoading && items && items.length === 0 && (
				<p className="text-frame-text-secondary">{ emptyHelp }</p>
			) }

			{ ! isLoading && items && items.length > 0 && (
				<ul className="border border-frame-border rounded-md divide-y divide-frame-border">
					{ items.map( ( item ) => {
						const isRemoving = pendingRemove === item.name;
						return (
							<li key={ item.name } className="flex items-center justify-between p-3 gap-4">
								<div className="min-w-0 flex-1">
									<div className="font-medium truncate">{ item.name }</div>
									<div
										className="text-frame-text-secondary text-xs truncate"
										title={ item.sourcePath }
									>
										{ item.sourcePath }
									</div>
								</div>
								<div className="flex items-center gap-1 shrink-0">
									<OpenInMenu sourcePath={ item.sourcePath } />
									<Button
										variant="tertiary"
										isDestructive
										onClick={ () => onRemove( item.name ) }
										disabled={ isRemoving }
									>
										{ isRemoving ? <Spinner /> : __( 'Unlink' ) }
									</Button>
								</div>
							</li>
						);
					} ) }
				</ul>
			) }
		</section>
	);
}

export function ContentTabLinkedExtensions( { selectedSite }: ContentTabLinkedExtensionsProps ) {
	const { __ } = useI18n();

	const { data: plugins, isLoading: pluginsLoading } = useGetLinkedPluginsQuery( selectedSite.id );
	const { data: themes, isLoading: themesLoading } = useGetLinkedThemesQuery( selectedSite.id );

	const [ linkPlugin, linkPluginState ] = useLinkPluginMutation();
	const [ linkTheme, linkThemeState ] = useLinkThemeMutation();
	const [ unlinkPlugin ] = useUnlinkPluginMutation();
	const [ unlinkTheme ] = useUnlinkThemeMutation();

	const [ removingPlugin, setRemovingPlugin ] = useState< string | null >( null );
	const [ removingTheme, setRemovingTheme ] = useState< string | null >( null );

	const handleAdd = async ( kind: Kind ) => {
		const dialogTitle =
			kind === 'plugin'
				? __( 'Select a plugin directory to link' )
				: __( 'Select a theme directory to link' );
		const folder = await getIpcApi().showOpenFolderDialog( dialogTitle, '' );
		if ( ! folder ) {
			return;
		}

		try {
			if ( kind === 'plugin' ) {
				await linkPlugin( { siteId: selectedSite.id, sourcePath: folder.path } ).unwrap();
			} else {
				await linkTheme( { siteId: selectedSite.id, sourcePath: folder.path } ).unwrap();
			}

			getIpcApi().showNotification( {
				title: kind === 'plugin' ? __( 'Plugin linked' ) : __( 'Theme linked' ),
				body: folder.path,
			} );
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: kind === 'plugin' ? __( 'Failed to link plugin' ) : __( 'Failed to link theme' ),
				message: extractErrorMessage( error ),
			} );
		}
	};

	const handleRemove = async ( kind: Kind, name: string ) => {
		const messageBoxTitle = kind === 'plugin' ? __( 'Unlink plugin?' ) : __( 'Unlink theme?' );
		const detail =
			kind === 'plugin'
				? __( 'This removes the link from the site only. Your source files are not deleted.' )
				: __( 'This removes the link from the site only. Your source files are not deleted.' );

		const result = await getIpcApi().showMessageBox( {
			type: 'question',
			title: messageBoxTitle,
			message: name,
			detail,
			buttons: [ __( 'Cancel' ), __( 'Unlink' ) ],
			defaultId: 1,
			cancelId: 0,
		} );

		if ( result.response !== 1 ) {
			return;
		}

		const setPending = kind === 'plugin' ? setRemovingPlugin : setRemovingTheme;
		setPending( name );
		try {
			if ( kind === 'plugin' ) {
				await unlinkPlugin( { siteId: selectedSite.id, name } ).unwrap();
			} else {
				await unlinkTheme( { siteId: selectedSite.id, name } ).unwrap();
			}
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: kind === 'plugin' ? __( 'Failed to unlink plugin' ) : __( 'Failed to unlink theme' ),
				message: extractErrorMessage( error ),
			} );
		} finally {
			setPending( null );
		}
	};

	return (
		<div className="p-8 max-w-3xl">
			<header className="mb-8">
				<h1 className="a8c-subtitle mb-2">{ __( 'Linked plugins and themes' ) }</h1>
				<p className="text-frame-text-secondary">
					{ __(
						'Symlink an external plugin or theme directory into this site. Edits to the source are reflected immediately.'
					) }
				</p>
			</header>

			<ExtensionList
				kind="plugin"
				siteId={ selectedSite.id }
				heading={ __( 'Plugins' ) }
				emptyHelp={ __( 'No linked plugins yet.' ) }
				addLabel={ __( '+ Link plugin' ) }
				dialogTitle={ __( 'Select a plugin directory to link' ) }
				items={ plugins }
				isLoading={ pluginsLoading }
				onAdd={ () => handleAdd( 'plugin' ) }
				onRemove={ ( name ) => handleRemove( 'plugin', name ) }
				pendingRemove={ removingPlugin }
				isAdding={ linkPluginState.isLoading }
			/>

			<ExtensionList
				kind="theme"
				siteId={ selectedSite.id }
				heading={ __( 'Themes' ) }
				emptyHelp={ __( 'No linked themes yet.' ) }
				addLabel={ __( '+ Link theme' ) }
				dialogTitle={ __( 'Select a theme directory to link' ) }
				items={ themes }
				isLoading={ themesLoading }
				onAdd={ () => handleAdd( 'theme' ) }
				onRemove={ ( name ) => handleRemove( 'theme', name ) }
				pendingRemove={ removingTheme }
				isAdding={ linkThemeState.isLoading }
			/>
		</div>
	);
}
