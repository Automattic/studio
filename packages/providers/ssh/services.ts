import { sshSites } from './sites';
import type { SshSite } from './descriptor';
import type { ProviderServices } from '../types';

export const sshServices: ProviderServices< undefined, SshSite > = {
	id: 'ssh',
	sites: sshSites,
};
