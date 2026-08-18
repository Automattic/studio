import { decodePassword } from '@studio/common/lib/passwords';
import { __ } from '@wordpress/i18n';
import { CopyButton } from '@/components/copy-button';
import styles from './cards.module.css';
import { CardSection } from './overview-card';
import type { SiteDetails } from '@/data/core';

function CredentialRow( {
	label,
	displayValue,
	copyText,
	copyLabel,
}: {
	label: string;
	displayValue: string;
	copyText: string;
	copyLabel: string;
} ) {
	return (
		<div className={ styles.credentialRow }>
			<span className={ styles.tileLabel }>{ label }</span>
			<div className={ styles.credentialValue }>
				<span className={ styles.credentialText }>{ displayValue }</span>
				<CopyButton text={ copyText } label={ copyLabel } />
			</div>
		</div>
	);
}

export function AdminSection( { site }: { site: SiteDetails } ) {
	const username = site.adminUsername ?? 'admin';
	const password = site.adminPassword ? decodePassword( site.adminPassword ) : '';
	const email = site.adminEmail ?? 'admin@localhost.com';

	return (
		<CardSection>
			<CredentialRow
				label={ __( 'Username' ) }
				displayValue={ username }
				copyText={ username }
				copyLabel={ __( 'Copy admin username' ) }
			/>
			<CredentialRow
				label={ __( 'Password' ) }
				displayValue={ '\u2022'.repeat( 12 ) }
				copyText={ password }
				copyLabel={ __( 'Copy admin password' ) }
			/>
			<CredentialRow
				label={ __( 'Email' ) }
				displayValue={ email }
				copyText={ email }
				copyLabel={ __( 'Copy admin email' ) }
			/>
		</CardSection>
	);
}
