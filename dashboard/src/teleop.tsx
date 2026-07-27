// mount(container, ctx): renders the drill teleop window from live
// module.drill.drill.state and publishes only module.drill.drill.cmd.
// ctx: { roverId, subscribe(subject, onBytes), publish?(subject, bytes) }
import { createRoot } from 'react-dom/client';
import { BridgeProvider } from './bridge';
import { DrillTeleop } from './drill/DrillTeleop';
import './ui/tokens.css';

type ModuleContext = {
  roverId: string;
  subscribe: (subject: string, onBytes: (b: Uint8Array) => void) => () => void;
  publish?: (subject: string, bytes: Uint8Array) => void;
};

// publish is optional in the teleop ctx; fall back to a no-op so the window
// still renders its telemetry when the host opens it without a publish channel.
const noopPublish = () => {};

export default {
  mount(container: HTMLElement, ctx: ModuleContext): () => void {
    const root = createRoot(container);
    root.render(
      <BridgeProvider
        value={{ roverId: ctx.roverId, subscribe: ctx.subscribe, publish: ctx.publish ?? noopPublish }}
      >
        <DrillTeleop />
      </BridgeProvider>,
    );
    return () => root.unmount();
  },
};
