import type { WillAppearEvent } from '@elgato/streamdeck';
import type { Settings } from '../service.js';
import type { Provider, WindowKind, Snapshot } from '../model.js';
type Key = WillAppearEvent<Settings>['action'];
export type Visible = {
  key: Key;
  provider: Provider;
  kind: WindowKind;
  settings: Settings;
  resetUntil: number;
  timer?: NodeJS.Timeout;
  painting?: boolean;
  repaintRequested?: boolean;
  revision: number;
  snapshot?: Snapshot;
};
type SignInSession = {
  home?: string;
  cancel?: () => void;
  url?: string;
  open?: () => Promise<void>;
};
export const state = {
  visible: new Map<string, Visible>(),
  signInSession: undefined as SignInSession | undefined,
  inspectorContext: undefined as string | undefined,
  connectingClaude: false
};
