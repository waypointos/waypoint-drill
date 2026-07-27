// Panel entry ([ui.static]). The host dynamic-imports this bundle and calls
// mount with its module context; the returned function unmounts the React root.
import { createRoot } from 'react-dom/client';
import { BridgeProvider } from './bridge';
import { DrillPanel } from './DrillPanel';
import './ui/tokens.css';

type ModuleContext = {
  roverId: string;
  subscribe: (subject: string, onBytes: (b: Uint8Array) => void) => () => void;
  publish: (subject: string, bytes: Uint8Array) => void;
  session?: { role: string };
};

export default {
  mount(container: HTMLElement, ctx: ModuleContext): () => void {
    const root = createRoot(container);
    root.render(
      <BridgeProvider value={{ roverId: ctx.roverId, subscribe: ctx.subscribe, publish: ctx.publish }}>
        <DrillPanel />
      </BridgeProvider>,
    );
    return () => root.unmount();
  },
};
