declare class Electrobun {
  static events: {
    on: (eventName: string, handler: (payload: unknown) => void) => void;
  };
}

export default Electrobun;

export declare class BrowserWindow {
  constructor(config: unknown);
  setSize: (width: number, height: number) => void;
  setMinSize?: (width: number, height: number) => void;
  close: () => void;
  minimize: () => void;
  maximize: () => void;
  unmaximize: () => void;
  isMaximized: () => boolean;
  on: (eventName: string, handler: (event: unknown) => void) => void;
}

export declare class BrowserView {
  static defineRPC<T>(config: unknown): {
    send: Record<string, (payload: unknown) => void>;
  };
}

export declare const ContextMenu: {
  showContextMenu: (items: unknown[]) => void;
};
