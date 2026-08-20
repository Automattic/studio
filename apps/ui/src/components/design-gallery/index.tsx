import { Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { wordpress } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	getLatestArtifact,
	groupDesignArtifacts,
} from '@/components/design-gallery/group-artifacts';
import { DesignGalleryTabs } from '@/components/design-gallery-tabs';
import { DotGrid } from '@/components/dot-grid';
import { SitePreview } from '@/components/site-preview';
import * as Tabs from '@/components/tabs';
import { useConnector } from '@/data/core';
import { useSelectDesignArtifact } from '@/data/queries/use-design-project';
import { getSiteUrl } from '@/lib/get-site-url';
import { EmptyBackground } from '@/ui-classic/components/session-view/empty-background';
import styles from './style.module.css';
import type { Annotation } from '@/components/site-preview';
import type { SiteDetails } from '@/data/core';
import type {
	AnnotationSubmissionContext,
	SessionPreviewAnnotationsHandler,
} from '@/hooks/use-session-ui';
import type { DesignArtifact, DesignProject } from '@studio/common/design-project';
import type { ReactNode } from 'react';

interface DesignGalleryProps {
	site: SiteDetails;
	project: DesignProject;
	sessionId?: string;
	onAnnotationsDone?: SessionPreviewAnnotationsHandler;
	collapsed?: boolean;
	fullscreen?: boolean;
	onFullscreenChange?: ( value: boolean ) => void;
}

function getArtifactPath( artifact: DesignArtifact, manifestRevision: number ): string {
	return `/.studio/design/${ artifact.path }?revision=${ manifestRevision }`;
}

export function DesignGallery( {
	site,
	project,
	sessionId,
	onAnnotationsDone,
	collapsed = false,
	fullscreen = false,
	onFullscreenChange,
}: DesignGalleryProps ) {
	const connector = useConnector();
	const selectArtifact = useSelectDesignArtifact( site.id );
	const [ selectedTabId, setSelectedTabId ] = useState( project.selectedArtifactId ?? 'all' );
	const [ artifactNavigation, setArtifactNavigation ] = useState< Record< string, string > >( {} );
	const [ isAccepting, setIsAccepting ] = useState( false );
	const [ actionError, setActionError ] = useState( '' );
	const groups = useMemo( () => groupDesignArtifacts( project.artifacts ), [ project.artifacts ] );
	const activeArtifact = useMemo(
		() => project.artifacts.find( ( artifact ) => artifact.id === selectedTabId ),
		[ project.artifacts, selectedTabId ]
	);
	const activeGroup = useMemo(
		() => groups.find( ( group ) => group.artifacts.some( ( item ) => item.id === selectedTabId ) ),
		[ groups, selectedTabId ]
	);
	const selectedGroupId = activeGroup?.id ?? 'all';
	const previousProjectSelection = useRef( project.selectedArtifactId );

	useEffect( () => {
		if (
			project.selectedArtifactId &&
			project.selectedArtifactId !== previousProjectSelection.current
		) {
			setSelectedTabId( project.selectedArtifactId );
		}
		previousProjectSelection.current = project.selectedArtifactId;
	}, [ project.selectedArtifactId ] );

	useEffect( () => {
		if ( selectedTabId !== 'all' && ! activeArtifact ) {
			setSelectedTabId( 'all' );
		}
	}, [ activeArtifact, selectedTabId ] );

	const previewPath = activeArtifact
		? artifactNavigation[ activeArtifact.id ] ??
		  getArtifactPath( activeArtifact, project.manifestRevision )
		: '/';
	const cachedPreviews = useMemo(
		() =>
			groups.flatMap( ( group, groupIndex ) =>
				group.artifacts.map( ( artifact ) => ( {
					key: artifact.id,
					path:
						artifactNavigation[ artifact.id ] ??
						getArtifactPath( artifact, project.manifestRevision ),
					position: groupIndex + 1,
				} ) )
			),
		[ artifactNavigation, groups, project.manifestRevision ]
	);
	const handlePreviewPathChange = useCallback(
		( path: string ) => {
			if ( ! activeArtifact ) return;
			setArtifactNavigation( ( current ) => ( { ...current, [ activeArtifact.id ]: path } ) );
		},
		[ activeArtifact ]
	);

	const accept = async () => {
		if ( ! activeArtifact || ! sessionId ) return;
		setIsAccepting( true );
		setActionError( '' );
		try {
			await selectArtifact.mutateAsync( activeArtifact.id );
			await connector.continueSession(
				sessionId,
				`I explicitly accept the design direction "${
					activeGroup?.label ?? activeArtifact.label
				}" (${
					activeArtifact.id
				}). Use design_artifact_accept, then materialize_design_artifact to build it as the native WordPress site. Verify the result and show me the live site when it is ready.`
			);
		} catch ( error ) {
			setActionError(
				error instanceof Error ? error.message : __( 'Studio could not start the site build.' )
			);
		} finally {
			setIsAccepting( false );
		}
	};

	const submitAnnotations = useCallback(
		( annotations: Annotation[] ) => {
			if ( ! activeArtifact || annotations.length === 0 || ! onAnnotationsDone ) return;
			setActionError( '' );
			void selectArtifact
				.mutateAsync( activeArtifact.id )
				.then( () =>
					onAnnotationsDone( annotations, {
						designArtifactId: activeArtifact.id,
						designArtifactLabel: activeGroup?.label ?? activeArtifact.label,
					} satisfies AnnotationSubmissionContext )
				)
				.catch( ( error ) => {
					setActionError(
						error instanceof Error
							? error.message
							: __( 'Studio could not submit the design feedback.' )
					);
				} );
		},
		[ activeArtifact, activeGroup?.label, onAnnotationsDone, selectArtifact ]
	);

	if ( project.artifacts.length === 0 ) {
		return (
			<div className={ styles.empty }>
				<EmptyBackground logoSize={ 360 } padding={ 150 } />
				<div className={ styles.emptyCopy }>
					{ [
						styles.emptyFrostSoft,
						styles.emptyFrostMedium,
						styles.emptyFrostStrong,
						styles.emptyFrostIntense,
					].map( ( frost ) => (
						<span
							key={ frost }
							className={ `${ styles.emptyFrost } ${ frost }` }
							aria-hidden="true"
						/>
					) ) }
					<div className={ styles.emptyCopyContent }>
						<Spinner />
						<h2>{ __( 'Creating three design directions' ) }</h2>
						<p>
							{ __(
								'Studio is exploring three ideas in parallel. Each will appear here when it’s ready.'
							) }
						</p>
					</div>
				</div>
			</div>
		);
	}

	const materializing = project.phase === 'accepted' || project.phase === 'materializing';
	const overview = (
		<div className={ styles.overview }>
			<div className={ styles.overviewGrid } aria-hidden="true">
				<DotGrid
					spacing={ 32 }
					crossSize={ 5 }
					crossThickness={ 0.75 }
					opacity={ 0.16 }
					intro={ false }
				/>
			</div>
			<div className={ styles.overviewContent }>
				<div className={ styles.grid }>
					{ groups.map( ( group ) => {
						const artifact = getLatestArtifact( group );
						const artifactPath = getArtifactPath( artifact, project.manifestRevision );
						return (
							<button
								key={ artifact.id }
								type="button"
								className={ styles.card }
								onClick={ () => setSelectedTabId( artifact.id ) }
							>
								<div className={ styles.cardPreview } aria-hidden="true">
									<iframe
										src={ `${ getSiteUrl( site ) }${ artifactPath }` }
										title=""
										sandbox=""
										tabIndex={ -1 }
									/>
								</div>
								<div className={ styles.cardDetails }>
									<strong>{ group.label }</strong>
								</div>
							</button>
						);
					} ) }
				</div>
			</div>
		</div>
	);

	return (
		<section className={ styles.root } aria-label={ __( 'Design gallery' ) }>
			<GalleryTabsRoot
				selectedTabId={ selectedGroupId }
				onSelect={ ( tabId ) => {
					if ( ! tabId || tabId === selectedGroupId ) return;
					if ( tabId === 'all' ) {
						setSelectedTabId( 'all' );
						return;
					}
					const group = groups.find( ( item ) => item.id === tabId );
					if ( group ) setSelectedTabId( getLatestArtifact( group ).id );
				} }
			>
				<div className={ styles.option }>
					<div className={ styles.browser }>
						<SitePreview
							site={ site }
							path={ previewPath }
							reloadNonce={ project.manifestRevision }
							onAnnotationsDone={ activeArtifact ? submitAnnotations : undefined }
							onPathChange={ activeArtifact ? handlePreviewPathChange : undefined }
							collapsed={ collapsed }
							fullscreen={ fullscreen }
							onFullscreenChange={ onFullscreenChange }
							locationContent={
								<DesignGalleryTabs
									groups={ groups }
									selectedGroupId={ selectedGroupId }
									activeArtifactId={ activeArtifact?.id }
									onSelectVersion={ setSelectedTabId }
								/>
							}
							contentOverride={ overview }
							contentOverrideActive={ selectedTabId === 'all' }
							navigationKey={ activeArtifact?.id }
							cachedPreviews={ cachedPreviews }
							activePreviewKey={ activeArtifact?.id }
						/>
						{ activeArtifact && materializing ? (
							<div className={ styles.building } role="status">
								<Spinner />
								<Icon icon={ wordpress } size={ 24 } />
								<span>
									{ __( 'Converting the accepted design into editable WordPress blocks…' ) }
								</span>
							</div>
						) : null }
						{ activeArtifact ? (
							<footer className={ styles.footer }>
								<div className={ styles.optionDetails }>
									<strong>{ activeGroup?.label ?? activeArtifact.label }</strong>
									<span>
										{ __( 'Studio will turn this design into an editable WordPress theme.' ) }
									</span>
								</div>
								{ actionError ? (
									<p className={ styles.actionError } role="alert">
										{ actionError }
									</p>
								) : null }
								<Button
									variant="solid"
									tone="brand"
									onClick={ () => void accept() }
									disabled={ ! sessionId || isAccepting || materializing }
								>
									{ isAccepting ? __( 'Starting build…' ) : __( 'Build this design' ) }
								</Button>
							</footer>
						) : null }
					</div>
				</div>
			</GalleryTabsRoot>
		</section>
	);
}

interface GalleryTabsRootProps {
	selectedTabId: string;
	onSelect: ( tabId: string | null | undefined ) => void;
	children: ReactNode;
}

function GalleryTabsRoot( { selectedTabId, onSelect, children }: GalleryTabsRootProps ) {
	return (
		<Tabs.Root selectedTabId={ selectedTabId } onSelect={ onSelect } className={ styles.tabsRoot }>
			<Tabs.Panel tabId={ selectedTabId } className={ styles.content }>
				{ children }
			</Tabs.Panel>
		</Tabs.Root>
	);
}
