import wpcomModule from 'wpcom';
import wpcomXhrRequestModule from 'wpcom-xhr-request';

// Normalize for both ESM (Vite/browser) and CJS (Electron IPC) contexts.
const wpcomFactory: typeof wpcomModule =
	typeof wpcomModule === 'function'
		? wpcomModule
		: ( wpcomModule as { default: typeof wpcomModule } ).default;

const wpcomXhrRequest: typeof wpcomXhrRequestModule =
	typeof wpcomXhrRequestModule === 'function'
		? wpcomXhrRequestModule
		: ( wpcomXhrRequestModule as { default: typeof wpcomXhrRequestModule } ).default;

// The WordPress.com REST client, authenticated with the account's token.
export function wpcomClient( token: string ) {
	return wpcomFactory( token, wpcomXhrRequest );
}
