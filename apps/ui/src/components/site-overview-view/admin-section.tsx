import {
	DEFAULT_ADMIN_EMAIL,
	DEFAULT_ADMIN_USERNAME,
	decodeAdminPassword,
} from '@studio/common/lib/passwords';
import { __ } from '@wordpress/i18n';
import { CardSection, CopyableRow } from './overview-card';
import type { SiteDetails } from '@/data/core';

export function AdminSection( { site }: { site: SiteDetails } ) {
	const username = site.adminUsername ?? DEFAULT_ADMIN_USERNAME;
	const password = decodeAdminPassword( site.adminPassword );
	const email = site.adminEmail ?? DEFAULT_ADMIN_EMAIL;

	return (
		<CardSection>
			<CopyableRow
				label={ __( 'Username' ) }
				displayValue={ username }
				copyText={ username }
				copyLabel={ __( 'Copy admin username' ) }
			/>
			<CopyableRow
				label={ __( 'Password' ) }
				displayValue={ '\u2022'.repeat( 12 ) }
				copyText={ password }
				copyLabel={ __( 'Copy admin password' ) }
			/>
			<CopyableRow
				label={ __( 'Email' ) }
				displayValue={ email }
				copyText={ email }
				copyLabel={ __( 'Copy admin email' ) }
			/>
		</CardSection>
	);
}
