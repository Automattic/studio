import '@/lib/theme/tokens.css';
import '@/lib/theme/base.css';
import '@/index.css';
import { useState } from 'react';
import { NoticeCard } from '@/features/notifications/notice-card';
import { NoticeTime } from '@/features/notifications/notice-history/notice-time';
import notices from './notice-review.json';
import styles from './notices.module.css';
import { renderPlayground } from './playground';
import type { NoticeRecord } from '@/data/app-messages';

type ReviewNotice = ( typeof notices )[ number ];
const noop = () => {};

function previewText( text: string | undefined, entry: ReviewNotice ): string | undefined {
	const values: Record< string, string > = {
		site: 'Maple & Pine',
		version: '2.0.4',
		'current version': '2.0.4',
		'new version': '2.1.0',
		destination: 'Terminal',
		operation: 'a site start',
		percentage: '80%',
		count: entry.title.includes( 'AI credits' )
			? '500,000'
			: /\{count\} (item|chat) (updated|archived)/.test( entry.title )
			? '1'
			: '3',
		updated: '3',
		selected: '5',
		failed: '2',
	};
	return text?.replace( /\{([^}]+)\}/g, ( token, key: string ) => values[ key ] ?? token );
}

function Preview( { entry, history }: { entry: ReviewNotice; history: boolean } ) {
	const [ now ] = useState( Date.now );
	const [ dismissed, setDismissed ] = useState( false );
	return dismissed ? (
		<button type="button" onClick={ () => setDismissed( false ) }>
			Restore notice
		</button>
	) : (
		<NoticeCard
			notice={ {
				title: previewText( entry.title, entry )!,
				description: previewText( entry.description, entry ),
				intent: entry.intent as NoticeRecord[ 'intent' ],
				source: entry.persistent ? 'studio' : undefined,
				action: entry.action ? { label: entry.action, onClick: noop } : undefined,
			} }
			time={ history ? <NoticeTime timestamp={ now } now={ now } /> : undefined }
			onDismiss={ () => setDismissed( true ) }
		/>
	);
}

function Notices() {
	const [ width, setWidth ] = useState( 320 );
	const [ search, setSearch ] = useState( '' );
	const [ history, setHistory ] = useState( true );
	const filtered = notices.filter( ( entry ) =>
		`${ entry.group } ${ previewText( entry.title, entry ) } ${
			previewText( entry.description, entry ) ?? ''
		} ${ entry.action ?? '' }`
			.toLowerCase()
			.includes( search.toLowerCase() )
	);
	const groups = [ ...new Set( filtered.map( ( entry ) => entry.group ) ) ];
	return (
		<div className={ styles.inventory }>
			<p>
				Current app wording in the real notice components, with realistic preview site names,
				versions, and counts. Actions are inert; expand and dismiss work.
			</p>
			<div className={ styles.controls }>
				<label>
					Surface{ ' ' }
					<select
						value={ history ? 'history' : 'toast' }
						onChange={ ( event ) => setHistory( event.target.value === 'history' ) }
					>
						<option value="history">Notification history</option>
						<option value="toast">Toast / sidebar</option>
					</select>
				</label>
				<label>
					Card width{ ' ' }
					<select
						value={ width }
						onChange={ ( event ) => setWidth( Number( event.target.value ) ) }
					>
						<option value={ 240 }>240px</option>
						<option value={ 320 }>320px</option>
						<option value={ 420 }>420px</option>
					</select>
				</label>
				<label>
					Find a notice{ ' ' }
					<input
						type="search"
						value={ search }
						onChange={ ( event ) => setSearch( event.target.value ) }
						placeholder="Search notices or actions"
					/>
				</label>
			</div>
			<p>
				{ filtered.length } notice variants. Error details supplied at runtime are omitted rather
				than invented. Timestamps show this review’s opening time.
			</p>
			{ groups.map( ( group ) => (
				<section className={ styles.inventory } key={ group }>
					<h2>{ group }</h2>
					{ filtered
						.filter( ( entry ) => entry.group === group )
						.map( ( entry, index ) => (
							<div
								className={ styles.frame }
								style={ { width } }
								key={ `${ entry.title }:${ index }` }
							>
								<Preview entry={ entry } history={ history } />
							</div>
						) ) }
				</section>
			) ) }
			{ filtered.length === 0 ? <p>No matching notices.</p> : null }
			<p>
				Raw errors from agent runs, chat submission, and agent-file editing vary by failure and are
				not shown here. Inline form errors and composer banners are separate surfaces.
			</p>
		</div>
	);
}

renderPlayground( 'Notices', <Notices /> );
