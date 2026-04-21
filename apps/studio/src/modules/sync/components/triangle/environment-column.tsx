import { Spinner } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { Badge } from 'src/components/badge';
import { useThemeDetails } from 'src/hooks/use-theme-details';
import { EnvironmentBadge } from 'src/modules/sync/components/environment-badge';
import { useEnvironmentSummary } from '../../hooks/use-environment-summary';
import type { SyncSite } from '@studio/common/types/sync';

type CommonProps = {
	/** 'landscape' = preview left, info right (hero/Local row). 'portrait' = preview on top, info below (side-by-side columns). */
	orientation?: 'landscape' | 'portrait';
};

type Props = CommonProps &
	(
		| {
				kind: 'local';
				label: 'Local';
				localSiteId: string;
				siteName: string;
				siteUrl: string;
				isRunning: boolean;
		  }
		| {
				kind: 'remote';
				label: 'Production' | 'Staging';
				site: SyncSite;
		  }
	);

function stripProtocol( url: string ): string {
	return url.replace( /^https?:\/\//, '' ).replace( /\/$/, '' );
}

function formatRelative( ts: string | null | undefined ): string | null {
	if ( ! ts ) return null;
	const delta = Date.now() - Date.parse( ts );
	if ( ! Number.isFinite( delta ) ) return null;
	const rtf = new Intl.RelativeTimeFormat( undefined, { numeric: 'auto' } );
	const hours = Math.round( delta / ( 1000 * 60 * 60 ) );
	if ( Math.abs( hours ) < 24 ) {
		return rtf.format( -hours, 'hour' );
	}
	const days = Math.round( hours / 24 );
	return rtf.format( -days, 'day' );
}

function Stat( { label, value, loading }: { label: string; value: number; loading: boolean } ) {
	return (
		<div className="flex flex-col">
			<dt className="a8c-helper-text text-frame-text-secondary">{ label }</dt>
			<dd className="a8c-subtitle-small text-frame-text">{ loading ? <Spinner /> : value }</dd>
		</div>
	);
}

type PreviewFrameProps = {
	children: React.ReactNode;
	siteIconUrl?: string;
	badge: React.ReactNode;
	orientation: 'landscape' | 'portrait';
};

function PreviewFrame( { children, siteIconUrl, badge, orientation }: PreviewFrameProps ) {
	const size = orientation === 'landscape' ? 'h-24 w-36 shrink-0' : 'aspect-[3/2] w-full shrink-0';
	return (
		<div className={ `relative overflow-hidden bg-frame-surface ${ size }` }>
			{ children }
			{ siteIconUrl && (
				<img
					src={ siteIconUrl }
					alt=""
					className="absolute bottom-1.5 left-1.5 h-6 w-6 rounded border border-white/30 bg-white object-cover"
				/>
			) }
			<div className="absolute bottom-1.5 right-1.5 rounded border border-white/30 bg-white/90 backdrop-blur-sm">
				{ badge }
			</div>
		</div>
	);
}

function MshotImage( { url }: { url: string } ) {
	const encoded = encodeURIComponent( url );
	const src = `https://s0.wp.com/mshots/v1/${ encoded }?w=400&h=260`;
	return <img src={ src } alt="" className="h-full w-full object-cover" loading="lazy" />;
}

function LocalPreviewImage( { siteName }: { siteName: string } ) {
	const { selectedThumbnail } = useThemeDetails();
	if ( selectedThumbnail ) {
		return (
			<img
				src={ selectedThumbnail }
				alt={ sprintf(
					/* translators: %s: The name of the website */
					__( 'Preview of the %s site' ),
					siteName
				) }
				className="h-full w-full object-cover object-top"
			/>
		);
	}
	return (
		<div className="flex h-full w-full items-center justify-center text-frame-text-secondary">
			<span className="a8c-helper-text">{ __( 'Local' ) }</span>
		</div>
	);
}

export function EnvironmentColumn( props: Props ) {
	const orientation = props.orientation ?? 'landscape';
	const summary = useEnvironmentSummary(
		props.kind === 'local'
			? { kind: 'local', localSiteId: props.localSiteId }
			: { kind: 'remote', siteId: props.site.id }
	);

	const name = props.kind === 'local' ? props.siteName : props.site.name;
	const url = props.kind === 'local' ? props.siteUrl : props.site.url;
	const lastPush = props.kind === 'remote' ? props.site.lastPushTimestamp : null;
	const lastPull = props.kind === 'remote' ? props.site.lastPullTimestamp : null;

	const rowTint =
		props.kind === 'local'
			? 'border-frame-border bg-frame-surface/40'
			: props.label === 'Production'
			? 'border-[#069e08]/30 bg-[#069e08]/5'
			: 'border-[#f7ba42]/40 bg-[#f7ba42]/5';

	// Drive the badge from the slot label, not from site metadata. This avoids
	// mislabeling a wpcom staging site whose data happens to have `isStaging: false`.
	const remoteBadgeType = props.kind === 'remote' && props.label === 'Staging' ? 'staging' : 'production';

	const preview =
		props.kind === 'remote' ? (
			<PreviewFrame
				orientation={ orientation }
				siteIconUrl={ props.site.siteIconUrl }
				badge={ <EnvironmentBadge type={ remoteBadgeType } /> }
			>
				<MshotImage url={ props.site.url } />
			</PreviewFrame>
		) : (
			<PreviewFrame
				orientation={ orientation }
				badge={ <Badge className="bg-transparent text-a8c-gray-800">{ __( 'Local' ) }</Badge> }
			>
				<LocalPreviewImage siteName={ props.siteName } />
			</PreviewFrame>
		);

	if ( orientation === 'portrait' ) {
		return (
			<div
				className={
					'mx-auto flex w-full max-w-[260px] flex-col overflow-hidden rounded-lg border ' + rowTint
				}
			>
				{ preview }
				<div className="flex flex-col gap-0.5 p-3">
					<div className="a8c-subtitle-small truncate text-frame-text">{ name }</div>
					<a
						href={ url }
						className="a8c-helper-text truncate text-frame-theme hover:text-frame-theme-hover hover:underline"
					>
						{ stripProtocol( url ) }
					</a>
					{ props.kind === 'remote' && (
						<div className="a8c-helper-text text-frame-text-secondary">
							{ __( 'WP' ) } { props.site.wpVersion ?? '—' }
							{ props.site.planName ? ` · ${ props.site.planName }` : '' }
						</div>
					) }
					<dl className="mt-1.5 flex flex-row gap-4">
						<Stat
							label={ __( 'Posts' ) }
							value={ summary.counts.posts }
							loading={ summary.isLoading }
						/>
						<Stat
							label={ __( 'Pages' ) }
							value={ summary.counts.pages }
							loading={ summary.isLoading }
						/>
					</dl>
					{ ( lastPush || lastPull ) && (
						<div className="a8c-helper-text mt-1 text-frame-text-secondary">
							{ lastPush && (
								<div>
									{ __( 'Pushed' ) } { formatRelative( lastPush ) }
								</div>
							) }
							{ lastPull && (
								<div>
									{ __( 'Pulled' ) } { formatRelative( lastPull ) }
								</div>
							) }
						</div>
					) }
				</div>
			</div>
		);
	}

	return (
		<div
			className={ 'flex flex-row overflow-hidden rounded-lg border ' + rowTint }
		>
			{ preview }
			<div className="flex min-w-0 flex-1 flex-col gap-0.5 p-3">
				<div className="a8c-subtitle-small truncate text-frame-text">{ name }</div>
				<a
					href={ url }
					className="a8c-helper-text truncate text-frame-theme hover:text-frame-theme-hover hover:underline"
				>
					{ stripProtocol( url ) }
				</a>
				{ props.kind === 'remote' && (
					<div className="a8c-helper-text text-frame-text-secondary">
						{ __( 'WP' ) } { props.site.wpVersion ?? '—' }
						{ props.site.planName ? ` · ${ props.site.planName }` : '' }
					</div>
				) }
				<dl className="mt-1.5 flex flex-row gap-4">
					<Stat
						label={ __( 'Posts' ) }
						value={ summary.counts.posts }
						loading={ summary.isLoading }
					/>
					<Stat
						label={ __( 'Pages' ) }
						value={ summary.counts.pages }
						loading={ summary.isLoading }
					/>
				</dl>
				{ ( lastPush || lastPull ) && (
					<div className="a8c-helper-text mt-1 text-frame-text-secondary">
						{ lastPush && (
							<div>
								{ __( 'Pushed' ) } { formatRelative( lastPush ) }
							</div>
						) }
						{ lastPull && (
							<div>
								{ __( 'Pulled' ) } { formatRelative( lastPull ) }
							</div>
						) }
					</div>
				) }
			</div>
		</div>
	);
}
