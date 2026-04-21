import type { SupportedEditor } from './editor';
import type { SupportedTerminal } from './terminal';

export type InstalledApps = Record< SupportedEditor | SupportedTerminal, boolean >;
