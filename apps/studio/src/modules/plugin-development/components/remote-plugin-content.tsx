import * as Sentry from '@sentry/electron/renderer';
import { __, sprintf } from '@wordpress/i18n';
import { Icon, cloud } from '@wordpress/icons';
import Button from 'src/components/button';
import { simplifyErrorForDisplay } from 'src/lib/error-formatting';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useDevelopmentProjects } from '../hooks/use-development-projects';
import { MetadataRow, ReadinessItem } from './shared-ui';
import type { RemoteDevelopmentPlugin } from '@studio/common/types/publishing';

function formatRemoteRoles( roles: RemoteDevelopmentPlugin[ 'roles' ] ) {
	if ( roles.length === 0 ) {
		return undefined;
	}

	return roles
		.map( ( role ) => ( role === 'committer' ? __( 'Committer' ) : __( 'Contributor' ) ) )
		.join( ', ' );
}

function getRemoteStateDescription( plugin: RemoteDevelopmentPlugin ) {
	if ( plugin.localState === 'missing' ) {
		return __( 'The previous local folder is missing. Studio can recreate the SVN checkout.' );
	}

	if ( plugin.localState === 'cloned' || plugin.localState === 'tracked' ) {
		return plugin.localPath || __( 'This WordPress.org plugin already has a local project.' );
	}

	return __( 'Clone the WordPress.org SVN repository before editing or publishing this plugin.' );
}

export function RemotePluginContent( { plugin }: { plugin: RemoteDevelopmentPlugin } ) {
	const { cloneRemotePlugin, cloningRemotePluginSlug, selectProject } = useDevelopmentProjects();
	const ipcApi = getIpcApi();
	const isCloning = cloningRemotePluginSlug === plugin.slug;
	const hasLocalProject = Boolean( plugin.localProjectId );

	const handlePrimaryAction = async () => {
		if ( plugin.localProjectId ) {
			selectProject( plugin.localProjectId );
			return;
		}

		try {
			await cloneRemotePlugin( plugin.slug );
		} catch ( error ) {
			Sentry.captureException( error );
			ipcApi.showErrorMessageBox( {
				title: __( 'Could not clone WordPress.org plugin' ),
				message: __( 'Studio could not create a local SVN checkout for this plugin.' ),
				error: simplifyErrorForDisplay( error ),
			} );
		}
	};

	return (
		<div className="flex flex-col w-full h-full app-no-drag-region pt-8 overflow-y-auto">
			<div className="flex justify-between items-start w-full gap-5 px-8">
				<div className="flex min-w-0 flex-col">
					<div className="flex items-center gap-2 text-frame-text-secondary text-sm">
						<Icon icon={ cloud } size={ 18 } className="fill-current" />
						<span>{ __( 'WordPress.org plugin' ) }</span>
					</div>
					<h1 className="text-xl font-medium max-h-full line-clamp-1 break-all mt-1">
						{ plugin.name }
					</h1>
					<div className="flex mt-1 gap-x-4 text-sm text-frame-text-secondary min-w-0">
						<span className="truncate">{ plugin.slug }</span>
						{ plugin.testedWith && (
							<span>
								{ sprintf(
									// translators: %s is a WordPress version number.
									__( 'Tested up to %s' ),
									plugin.testedWith
								) }
							</span>
						) }
					</div>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<Button variant="secondary" onClick={ () => ipcApi.openURL( plugin.url ) }>
						{ __( 'Open on WordPress.org' ) }
					</Button>
					<Button variant="primary" onClick={ handlePrimaryAction } disabled={ isCloning }>
						{ hasLocalProject
							? __( 'Open local project' )
							: isCloning
							? __( 'Cloning…' )
							: __( 'Work on this' ) }
					</Button>
				</div>
			</div>

			<div className="px-8 pb-8 mt-7 flex flex-col gap-8 max-w-[960px]">
				<section>
					<h2 className="a8c-subtitle-small mb-3">{ __( 'Local development' ) }</h2>
					<ul className="rounded-sm border border-frame-border bg-frame-surface px-4">
						<ReadinessItem
							label={ hasLocalProject ? __( 'Local project' ) : __( 'Local checkout' ) }
							description={ getRemoteStateDescription( plugin ) }
							state={ hasLocalProject ? 'ready' : 'next' }
						/>
					</ul>
				</section>

				<section>
					<h2 className="a8c-subtitle-small mb-3">{ __( 'WordPress.org' ) }</h2>
					<div className="rounded-sm border border-frame-border bg-frame-surface p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
						<MetadataRow label={ __( 'Slug' ) } value={ plugin.slug } />
						<MetadataRow label={ __( 'Role' ) } value={ formatRemoteRoles( plugin.roles ) } />
						<MetadataRow label={ __( 'Author' ) } value={ plugin.author } />
						<MetadataRow label={ __( 'Active installs' ) } value={ plugin.activeInstalls } />
						<MetadataRow label={ __( 'Tested up to' ) } value={ plugin.testedWith } />
						<MetadataRow label={ __( 'URL' ) } value={ plugin.url } />
						<MetadataRow label={ __( 'Local folder' ) } value={ plugin.localPath } />
					</div>
				</section>
			</div>
		</div>
	);
}
