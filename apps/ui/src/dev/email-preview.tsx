import '@/lib/theme/tokens.css';
import '@/lib/theme/base.css';
import '@/index.css';
import { useState } from 'react';
import { EmailView } from '@/features/sites/email-view';
import { Tabs, TabsList, TabsScopeIndicator, TabsTrigger } from '@/lib/ui';
import styles from './email-preview.module.css';
import { renderPlayground } from './playground';
import type { SiteEmail } from '@/data/core';

const states = [
	{ id: 'skeleton', label: 'Loading' },
	{ id: 'empty', label: 'No emails' },
	{ id: 'multiple', label: 'Multiple emails' },
	{ id: 'error', label: 'Could not load' },
] as const;

const subjects = [
	'[Jay Montclaire] Your password reset request',
	'Welcome to Jay Montclaire',
	'New comment on “A day in the studio”',
	'Your weekly site summary',
	'[Jay Montclaire] Plugins were updated successfully',
	'Your account email has been changed',
	'Thanks for subscribing',
	'[Jay Montclaire] Your site has updated to WordPress 7.1.4',
];

const samples: SiteEmail[] = subjects.map( ( subject, index ) => {
	const text = `Hi there,\n\n${ subject }.\n\nThis is a sample email for the Studio preview.\n\nThe WordPress Team`;
	return {
		id: `preview-${ index }.eml`,
		subject,
		from: { name: 'WordPress', address: 'wordpress@example.com' },
		to: [ { name: '', address: index % 2 ? 'jay@example.com' : 'admin@example.com' } ],
		cc: [],
		replyTo: [],
		date: new Date( Date.now() - index * 6 * 60 * 60 * 1000 ).toISOString(),
		html: null,
		text,
		attachments: [],
		source: `Subject: ${ subject }\n\n${ text }`,
	};
} );

function EmailPreview() {
	const initial = new URLSearchParams( window.location.search ).get( 'state' );
	const [ state, setState ] = useState(
		states.find( ( item ) => item.id === initial )?.id ?? 'empty'
	);
	return (
		<div className={ styles.preview }>
			<Tabs value={ state } onValueChange={ setState }>
				<TabsList variant="scope" aria-label="Email preview state">
					{ states.map( ( item ) => (
						<TabsTrigger key={ item.id } value={ item.id }>
							{ item.label }
						</TabsTrigger>
					) ) }
					<TabsScopeIndicator />
				</TabsList>
			</Tabs>
			<div className={ styles.stage }>
				<EmailView
					key={ state }
					siteId={ `email-preview-${ state }` }
					active={ state !== 'error' }
					onOpenLink={ () => {} }
				/>
			</div>
		</div>
	);
}

renderPlayground( 'Email log', <EmailPreview />, {
	getSiteEmails: async ( siteId ) => {
		if ( siteId === 'email-preview-skeleton' ) return new Promise( () => {} );
		if ( siteId === 'email-preview-error' ) throw new Error( 'Preview error' );
		return siteId === 'email-preview-multiple' ? samples : [];
	},
	getSiteEmail: async ( _siteId, emailId ) =>
		samples.find( ( email ) => email.id === emailId ) ?? null,
} );
