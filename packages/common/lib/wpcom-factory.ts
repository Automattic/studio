import wpcomModule from 'wpcom';

// Normalize for both ESM (Vite/browser) and CJS (Electron IPC) contexts.
const wpcomFactory: typeof wpcomModule =
	typeof wpcomModule === 'function'
		? wpcomModule
		: ( wpcomModule as { default: typeof wpcomModule } ).default;

export default wpcomFactory;
