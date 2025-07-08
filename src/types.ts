import { CONTENTS_SYNC_OPTIONS, SYNC_OPTIONS } from 'src/constants';

export type SyncOption = keyof typeof SYNC_OPTIONS;
export type ContentsSyncOption = keyof typeof CONTENTS_SYNC_OPTIONS;
