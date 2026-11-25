import { SshConnectForm } from './connect-form';
import type { SshSite } from './descriptor';
import type { ProviderUi } from '../types';

export const sshUi: ProviderUi< SshSite > = { ConnectForm: SshConnectForm };
