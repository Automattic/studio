import { __, _n, sprintf } from '@wordpress/i18n';
import {
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
	type KeyboardEvent,
	type RefObject,
} from 'react';
import { showToast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useSiteEmail, useSiteEmails } from '@/data/queries/use-site-emails';
import { ArrowLeftIcon, FolderIcon, MailIcon } from '@/lib/icons';
import {
	CodeBlock,
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
	IconButton,
	Skeleton,
	Spinner,
	Tabs,
	TabsList,
	TabsScopeIndicator,
	TabsTrigger,
} from '@/lib/ui';
import { EmailHtml, EmailText } from './email-body';
import styles from './style.module.css';
import type { SiteEmail, SiteEmailAddress, SiteEmailSummary } from '@/data/core';

type BodyView = 'html' | 'text' | 'source';

function formatAddress( { name, address }: SiteEmailAddress ) {
	return name ? `${ name } <${ address }>` : address;
}

function formatRecipients( to: SiteEmailAddress[] ) {
	if ( ! to.length ) {
		return __( 'No recipient' );
	}
	const first = to[ 0 ].name || to[ 0 ].address;
	return to.length === 1
		? first
		: sprintf(
				/* translators: 1: the first recipient of an email, 2: how many more there are. */
				__( '%1$s +%2$d' ),
				first,
				to.length - 1
		  );
}

// Today's email shows its time; older email, its day.
function formatListDate( date: string ) {
	const sent = new Date( date );
	return sent.toDateString() === new Date().toDateString()
		? sent.toLocaleTimeString( undefined, { hour: 'numeric', minute: '2-digit' } )
		: sent.toLocaleDateString( undefined, { month: 'short', day: 'numeric' } );
}

function formatSize( bytes: number ) {
	return bytes < 1024
		? sprintf(
				/* translators: %d: a file size in bytes. */
				__( '%d B' ),
				bytes
		  )
		: sprintf(
				/* translators: %s: a file size in kilobytes. */
				__( '%s KB' ),
				( bytes / 1024 ).toLocaleString( undefined, { maximumFractionDigits: 1 } )
		  );
}

// Below this width the list and the email take turns.
const SINGLE_PANE_WIDTH = 560;

function useSinglePane( ref: RefObject< HTMLElement | null > ) {
	const [ single, setSingle ] = useState( false );
	useLayoutEffect( () => {
		const node = ref.current;
		if ( ! node ) {
			return;
		}
		// No width yet means no layout yet, not a narrow preview.
		const measure = () => {
			const { width } = node.getBoundingClientRect();
			setSingle( width > 0 && width < SINGLE_PANE_WIDTH );
		};
		measure();
		if ( typeof ResizeObserver === 'undefined' ) {
			return;
		}
		const observer = new ResizeObserver( measure );
		observer.observe( node );
		return () => observer.disconnect();
	}, [ ref ] );
	return single;
}

// One stop in the tab order: the arrow keys move through the list.
function EmailRow( {
	id,
	email,
	selected,
	tabbable,
	onSelect,
}: {
	id: string;
	email: SiteEmailSummary;
	selected: boolean;
	tabbable: boolean;
	onSelect: () => void;
} ) {
	return (
		<li
			id={ id }
			role="option"
			aria-selected={ selected }
			tabIndex={ tabbable ? 0 : -1 }
			className={ styles.row }
			onClick={ onSelect }
		>
			<span className={ styles.rowLine }>
				<span className={ styles.rowSubject }>{ email.subject || __( '(No subject)' ) }</span>
				<time className={ styles.rowDate } dateTime={ email.date }>
					{ formatListDate( email.date ) }
				</time>
			</span>
			<span className={ styles.rowRecipients }>
				{ sprintf(
					/* translators: %s: who an email was sent to. */
					__( 'To %s' ),
					formatRecipients( email.to )
				) }
			</span>
		</li>
	);
}

function AddressLine( { label, addresses }: { label: string; addresses: SiteEmailAddress[] } ) {
	if ( ! addresses.length ) {
		return null;
	}
	return (
		<>
			<dt>{ label }</dt>
			<dd>{ addresses.map( formatAddress ).join( ', ' ) }</dd>
		</>
	);
}

function EmailMessage( {
	email,
	focusOnOpen,
	onBack,
	onOpenLink,
}: {
	email: SiteEmail;
	// It replaces the list on screen, so focus moves to it.
	focusOnOpen: boolean;
	onBack: () => void;
	onOpenLink: ( url: string ) => void;
} ) {
	const articleRef = useRef< HTMLElement >( null );
	const [ focusOnMount ] = useState( focusOnOpen );
	useEffect( () => {
		if ( focusOnMount ) {
			articleRef.current?.focus();
		}
	}, [ focusOnMount ] );
	const views: BodyView[] = [
		...( email.html ? [ 'html' as const ] : [] ),
		...( email.text ? [ 'text' as const ] : [] ),
		'source',
	];
	const [ chosenView, setView ] = useState< BodyView >( views[ 0 ] );
	const view = views.includes( chosenView ) ? chosenView : views[ 0 ];
	const viewLabels: Record< BodyView, string > = {
		html: __( 'HTML' ),
		text: __( 'Text' ),
		source: __( 'Source' ),
	};

	return (
		<article
			ref={ articleRef }
			tabIndex={ -1 }
			className={ styles.message }
			aria-label={ email.subject || __( '(No subject)' ) }
		>
			<header className={ styles.messageHeader }>
				<IconButton
					className={ styles.back }
					icon={ <ArrowLeftIcon /> }
					label={ __( 'Back to email list' ) }
					size="icon-sm"
					onClick={ onBack }
				/>
				<h2 className={ styles.subject }>{ email.subject || __( '(No subject)' ) }</h2>
				<dl className={ styles.meta }>
					<AddressLine label={ __( 'From' ) } addresses={ email.from ? [ email.from ] : [] } />
					<AddressLine label={ __( 'To' ) } addresses={ email.to } />
					<AddressLine label={ __( 'Cc' ) } addresses={ email.cc } />
					<AddressLine label={ __( 'Reply to' ) } addresses={ email.replyTo } />
					<dt>{ __( 'Date' ) }</dt>
					<dd>
						<time dateTime={ email.date }>
							{ new Date( email.date ).toLocaleString( undefined, {
								dateStyle: 'medium',
								timeStyle: 'short',
							} ) }
						</time>
					</dd>
				</dl>
				{ email.attachments.length ? (
					<ul className={ styles.attachments } aria-label={ __( 'Attachments' ) }>
						{ email.attachments.map( ( attachment, index ) => (
							<li key={ index } className={ styles.attachment }>
								<span className={ styles.attachmentName }>
									{ attachment.filename || attachment.mimeType }
								</span>
								<span className={ styles.attachmentSize }>{ formatSize( attachment.size ) }</span>
							</li>
						) ) }
					</ul>
				) : null }
				{ views.length > 1 ? (
					<Tabs value={ view } onValueChange={ ( value ) => setView( value as BodyView ) }>
						<TabsList
							variant="scope"
							aria-label={ __( 'Email format' ) }
							className={ styles.views }
						>
							{ views.map( ( option ) => (
								<TabsTrigger key={ option } value={ option }>
									{ viewLabels[ option ] }
								</TabsTrigger>
							) ) }
							<TabsScopeIndicator />
						</TabsList>
					</Tabs>
				) : null }
			</header>
			<div className={ styles.body }>
				{ view === 'html' && email.html ? (
					<EmailHtml html={ email.html } onOpenLink={ onOpenLink } />
				) : view === 'text' && email.text ? (
					<EmailText text={ email.text } onOpenLink={ onOpenLink } />
				) : (
					<CodeBlock code={ email.source } className={ styles.source } />
				) }
			</div>
		</article>
	);
}

function EmailListSkeleton() {
	return (
		<ul className={ styles.rows } aria-hidden="true">
			{ [ '70%', '55%', '80%' ].map( ( width ) => (
				<li key={ width } className={ styles.skeletonRow }>
					<Skeleton className={ styles.skeletonLine } style={ { width } } />
					<Skeleton className={ styles.skeletonLine } style={ { width: '40%' } } />
				</li>
			) ) }
		</ul>
	);
}

/**
 * The email a site sent, as Studio caught it: a list beside the email it's
 * reading. In a narrow preview, one at a time.
 */
export function EmailView( {
	siteId,
	active,
	onOpenLink,
}: {
	siteId: string;
	// On screen, so new email is looked for.
	active: boolean;
	onOpenLink: ( url: string ) => void;
} ) {
	const connector = useConnector();
	const emails = useSiteEmails( siteId, { watching: active } );
	const [ selectedId, setSelectedId ] = useState< string | null >( null );
	const [ activeId, setActiveId ] = useState< string | null >( null );
	const containerRef = useRef< HTMLDivElement >( null );
	const single = useSinglePane( containerRef );
	const rowIdPrefix = useId();
	const rowId = ( emailId: string ) => `${ rowIdPrefix }-${ emailId }`;
	const ids = emails.data?.map( ( summary ) => summary.id ) ?? [];
	// Studio keeps a site's newest 100 emails, so the one being read can go.
	const selected = selectedId && ids.includes( selectedId ) ? selectedId : null;
	const tabbableId = activeId && ids.includes( activeId ) ? activeId : selected ?? ids[ 0 ];
	const email = useSiteEmail( siteId, selected );
	const count = ids.length;

	// Back in the list, focus returns to the email that was open.
	const refocusRef = useRef< string | null >( null );
	useEffect( () => {
		if ( refocusRef.current && ! selected ) {
			document.getElementById( rowId( refocusRef.current ) )?.focus();
			refocusRef.current = null;
		}
	} );

	const select = ( emailId: string ) => {
		setActiveId( emailId );
		setSelectedId( emailId );
	};

	const handleListKeyDown = ( event: KeyboardEvent< HTMLUListElement > ) => {
		if ( ! tabbableId ) {
			return;
		}
		const index = ids.indexOf( tabbableId );
		const moves: Record< string, number > = {
			ArrowDown: index + 1,
			ArrowUp: index - 1,
			Home: 0,
			End: ids.length - 1,
		};
		if ( event.key in moves ) {
			event.preventDefault();
			const next = ids[ Math.min( Math.max( moves[ event.key ], 0 ), ids.length - 1 ) ];
			setActiveId( next );
			document.getElementById( rowId( next ) )?.focus();
			// Side by side, the email opens as the list moves, as in mail apps.
			if ( ! single ) {
				setSelectedId( next );
			}
			return;
		}
		if ( event.key === 'Enter' || event.key === ' ' ) {
			event.preventDefault();
			select( tabbableId );
		}
	};

	return (
		<div ref={ containerRef } className={ styles.container }>
			{ emails.data && ! count ? (
				<Empty className={ styles.empty }>
					<EmptyHeader>
						<EmptyMedia>
							<MailIcon />
						</EmptyMedia>
						<EmptyTitle>{ __( 'No email yet' ) }</EmptyTitle>
						<EmptyDescription>
							{ __(
								'Email that this site sends shows here, such as password resets and new user notices.'
							) }
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div
					className={ styles.root }
					data-layout={ single ? 'single' : 'split' }
					data-reading={ selected ? '' : undefined }
				>
					<section className={ styles.list } aria-label={ __( 'Email' ) }>
						<header className={ styles.listHeader }>
							<h2 className={ styles.listTitle }>{ __( 'Email' ) }</h2>
							{ emails.data ? (
								<span className={ styles.count }>
									{ sprintf(
										/* translators: %d: how many emails a site has sent. */
										_n( '%d email', '%d emails', count ),
										count
									) }
								</span>
							) : null }
							<IconButton
								className={ styles.folder }
								icon={ <FolderIcon /> }
								label={ __( 'Open email folder' ) }
								size="icon-sm"
								onClick={ () =>
									connector.openSiteEmailFolder( siteId ).catch( () =>
										showToast( {
											title: __( 'Studio could not open the email folder.' ),
											intent: 'error',
										} )
									)
								}
							/>
						</header>
						{ emails.isError ? (
							<p className={ styles.error }>{ __( 'Studio could not read the email.' ) }</p>
						) : ! emails.data ? (
							<EmailListSkeleton />
						) : (
							<ul
								role="listbox"
								aria-label={ __( 'Email' ) }
								className={ styles.rows }
								onKeyDown={ handleListKeyDown }
							>
								{ emails.data.map( ( summary ) => (
									<EmailRow
										key={ summary.id }
										id={ rowId( summary.id ) }
										email={ summary }
										selected={ summary.id === selected }
										tabbable={ summary.id === tabbableId }
										onSelect={ () => select( summary.id ) }
									/>
								) ) }
							</ul>
						) }
					</section>
					<div className={ styles.reader }>
						{ ! selected ? (
							<p className={ styles.hint }>{ __( 'Select an email to read it.' ) }</p>
						) : email.data ? (
							<EmailMessage
								key={ email.data.id }
								email={ email.data }
								focusOnOpen={ single }
								onBack={ () => {
									refocusRef.current = selected;
									setSelectedId( null );
								} }
								onOpenLink={ onOpenLink }
							/>
						) : email.isPending ? (
							<div className={ styles.hint }>
								<Spinner />
							</div>
						) : (
							<p className={ styles.hint }>{ __( 'This email is gone.' ) }</p>
						) }
					</div>
				</div>
			) }
		</div>
	);
}
