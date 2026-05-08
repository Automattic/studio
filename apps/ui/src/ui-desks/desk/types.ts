import type { DeskWidget } from '@/ui-desks/widgets/types';
import type { DeskConfig as BaseDeskConfig } from '@studio/common/types/desk';

export { DESK_CONFIG_VERSION } from '@studio/common/types/desk';
export type { DeskViewport, DeskWidgetBase } from '@studio/common/types/desk';

export type DeskConfig = BaseDeskConfig< DeskWidget >;
