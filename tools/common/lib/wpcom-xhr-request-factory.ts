import wpcomXhrRequestModule from 'wpcom-xhr-request';

// Normalize for both ESM (Vite/browser) and CJS (Electron IPC) contexts.
const wpcomXhrRequest: typeof wpcomXhrRequestModule =
	typeof wpcomXhrRequestModule === 'function'
		? wpcomXhrRequestModule
		: ( wpcomXhrRequestModule as { default: typeof wpcomXhrRequestModule } ).default;

export default wpcomXhrRequest;
