import wpcomXhrRequestModule from 'wpcom-xhr-request';

// Normalize for both ESM (Vite/browser) and CJS (Electron IPC) contexts.
/* eslint-disable @typescript-eslint/no-explicit-any */
const wpcomXhrRequest: any =
	typeof wpcomXhrRequestModule === 'function'
		? wpcomXhrRequestModule
		: ( wpcomXhrRequestModule as any ).default ?? wpcomXhrRequestModule;

export default wpcomXhrRequest;
