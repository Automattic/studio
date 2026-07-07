import {
	getTerminalName as getTerminalNameShared,
	getTerminalsSupportedOnPlatform as getTerminalsSupportedOnPlatformShared,
	type SupportedTerminal,
	type TerminalPlatform,
} from '@studio/common/lib/user-settings/terminal';
import { getAppGlobals } from 'src/lib/app-globals';

export {
	SUPPORTED_TERMINALS,
	terminalConfig,
	type SupportedTerminal,
	type TerminalConfig,
	type TerminalPlatform,
} from '@studio/common/lib/user-settings/terminal';

function currentPlatform(): TerminalPlatform {
	return getAppGlobals().platform as TerminalPlatform;
}

export function getTerminalsSupportedOnPlatform(): SupportedTerminal[] {
	return getTerminalsSupportedOnPlatformShared( currentPlatform() );
}

export function getTerminalName( terminal: SupportedTerminal | undefined ): string {
	return getTerminalNameShared( terminal, currentPlatform() );
}
