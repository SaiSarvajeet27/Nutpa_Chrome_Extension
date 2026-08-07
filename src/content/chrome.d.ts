// Minimal chrome typing for the content script (avoids @types/chrome dependency).
declare const chrome: {
  runtime: {
    sendMessage: (message: unknown) => Promise<unknown>;
    onMessage: {
      addListener: (cb: (message: any, sender: any, sendResponse: (r?: unknown) => void) => void) => void;
      removeListener: (cb: (message: any, sender: any, sendResponse: (r?: unknown) => void) => void) => void;
    };
  };
  storage: {
    local: {
      get: (key?: string | string[] | Record<string, unknown>) => Promise<Record<string, any>>;
      set: (items: Record<string, unknown>) => Promise<void>;
      remove: (key: string | string[]) => Promise<void>;
    };
  };
};
