import { Button, Spinner } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import {
	useGetLinkedPluginsQuery,
	useGetLinkedThemesQuery,
	useLinkPluginMutation,
	useLinkThemeMutation,
	useUnlinkPluginMutation,
	useUnlinkThemeMutation,
} from 'src/stores/linked-extensions-api';
import type { LinkedExtension } from 'src/lib/plugin-theme-link';

interface ContentTabLinkedExtensionsProps {
	selectedSite: SiteDetails;
}

type Kind = 'plugin' | 'theme';

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
								<div className="min-w-0">
									<div className="font-medium truncate">{ item.name }</div>
									<button
										type="button"
										className="text-frame-text-secondary text-xs truncate text-left hover:underline"
										onClick={ () => getIpcApi().showItemInFolder( item.sourcePath ) }
										title={ item.sourcePath }
									>
										{ item.sourcePath }
									</button>
								</div>
								<Button
									variant="tertiary"
									isDestructive
									onClick={ () => onRemove( item.name ) }
									disabled={ isRemoving }
								>
									{ isRemoving ? <Spinner /> : __( 'Unlink' ) }
								</Button>
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
			const result =
				kind === 'plugin'
					? await linkPlugin( { siteId: selectedSite.id, sourcePath: folder.path } ).unwrap()
					: await linkTheme( { siteId: selectedSite.id, sourcePath: folder.path } ).unwrap();

			if ( result.alreadyLinked ) {
				getIpcApi().showNotification( {
					title: kind === 'plugin' ? __( 'Plugin already linked' ) : __( 'Theme already linked' ),
					body: result.name,
				} );
			} else {
				getIpcApi().showNotification( {
					title: kind === 'plugin' ? __( 'Plugin linked' ) : __( 'Theme linked' ),
					body: result.name,
				} );
			}
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: kind === 'plugin' ? __( 'Failed to link plugin' ) : __( 'Failed to link theme' ),
				message: error instanceof Error ? error.message : String( error ),
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
				message: error instanceof Error ? error.message : String( error ),
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
