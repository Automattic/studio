import { Spinner } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { Badge } from 'src/components/badge';
import { useThemeDetails } from 'src/hooks/use-theme-details';
import { EnvironmentBadge } from 'src/modules/sync/components/environment-badge';
import { getSiteEnvironment } from 'src/modules/sync/lib/environment-utils';
import { useEnvironmentSummary } from '../../hooks/use-environment-summary';
import type { SyncSite } from '@studio/common/types/sync';

type Props =
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
	  };

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

function Mshot( props: { url: string } ) {
	const encoded = encodeURIComponent( props.url );
	const src = `https://s0.wp.com/mshots/v1/${ encoded }?w=320`;
	return (
		<img src={ src } alt="" className="h-20 w-32 shrink-0 rounded object-cover" loading="lazy" />
	);
}

function LocalPreview( { siteName }: { siteName: string } ) {
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
				className="h-20 w-32 shrink-0 rounded object-cover object-top"
			/>
		);
	}
	return (
		<div className="flex h-20 w-32 shrink-0 items-center justify-center rounded bg-frame-surface text-frame-text-secondary">
			<span className="a8c-helper-text">{ __( 'Local' ) }</span>
		</div>
	);
}

export function EnvironmentColumn( props: Props ) {
	const summary = useEnvironmentSummary(
		props.kind === 'local'
			? { kind: 'local', localSiteId: props.localSiteId }
			: { kind: 'remote', siteId: props.site.id }
	);

	const name = props.kind === 'local' ? props.siteName : props.site.name;
	const url = props.kind === 'local' ? props.siteUrl : props.site.url;
	const lastPush = props.kind === 'remote' ? props.site.lastPushTimestamp : null;
	const lastPull = props.kind === 'remote' ? props.site.lastPullTimestamp : null;

	return (
		<div className="flex flex-row items-center gap-4 rounded-lg border border-frame-border bg-frame-bg p-4">
			{ props.kind === 'remote' ? (
				<Mshot url={ props.site.url } />
			) : (
				<LocalPreview siteName={ props.siteName } />
			) }

			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div>
					{ props.kind === 'remote' ? (
						<EnvironmentBadge type={ getSiteEnvironment( props.site ) } />
					) : (
						<Badge className="bg-frame-surface text-frame-text-secondary">{ __( 'Local' ) }</Badge>
					) }
				</div>
				<div className="a8c-subtitle truncate text-frame-text">{ name }</div>
				<a
					href={ url }
					className="a8c-link-text truncate text-frame-theme hover:text-frame-theme-hover hover:underline"
				>
					{ stripProtocol( url ) }
				</a>
				{ props.kind === 'remote' && (
					<div className="a8c-helper-text text-frame-text-secondary">
						{ __( 'WP' ) } { props.site.wpVersion ?? '—' }
						{ props.site.planName ? ` · ${ props.site.planName }` : '' }
					</div>
				) }
			</div>

			<dl className="flex shrink-0 flex-row gap-6">
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
				<div className="a8c-helper-text shrink-0 text-right text-frame-text-secondary">
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
	);
}
