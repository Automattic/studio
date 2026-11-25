import { SshConnectForm } from './ssh/connect-form';
import type { ConnectFormProps, SitesProviderId } from './types';

// The form describing a site of a provider whose `sites.connect` connects one by form.
export function ConnectForm( {
	provider,
	...props
}: ConnectFormProps & { provider: SitesProviderId } ) {
	return provider === 'ssh' ? <SshConnectForm { ...props } /> : null;
}
