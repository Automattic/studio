import { Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
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
			<dt className="text-xs text-gray-500">{ label }</dt>
			<dd className="text-base font-medium">{ loading ? <Spinner /> : value }</dd>
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

function LocalTile() {
	return (
		<div className="flex h-20 w-32 shrink-0 items-center justify-center rounded bg-gray-100 text-gray-400 dark:bg-gray-800">
			<span className="text-xs">{ __( 'Local' ) }</span>
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
	const statusOk = props.kind === 'local' ? props.isRunning : props.site.syncSupport === 'syncable';
	const lastPush = props.kind === 'remote' ? props.site.lastPushTimestamp : null;
	const lastPull = props.kind === 'remote' ? props.site.lastPullTimestamp : null;

	return (
		<div className="flex flex-row items-center gap-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
			{ props.kind === 'remote' ? <Mshot url={ props.site.url } /> : <LocalTile /> }

			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500">
					<span
						className={
							'inline-block h-2 w-2 rounded-full ' + ( statusOk ? 'bg-green-500' : 'bg-gray-400' )
						}
						aria-hidden="true"
					/>
					<span>{ props.label }</span>
				</div>
				<div className="truncate text-base font-semibold">{ name }</div>
				<a href={ url } className="truncate text-sm text-blue-600 hover:underline">
					{ stripProtocol( url ) }
				</a>
				{ props.kind === 'remote' && (
					<div className="text-xs text-gray-500">
						{ __( 'WP' ) } { props.site.wpVersion ?? '—' }
						{ props.site.planName ? ` · ${ props.site.planName }` : '' }
					</div>
				) }
			</div>

			<dl className="flex shrink-0 flex-row gap-6 text-sm">
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
				<div className="shrink-0 text-right text-xs text-gray-500">
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
