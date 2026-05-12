/**
 * JW-02
 * Entry point. Renders UI immediately, defers audio init to first interaction.
 */
import { SynthEngine } from './synth/SynthEngine.js';
import { UI } from './ui/UI.js';

function main() {
  const engine = new SynthEngine();
  const ui = new UI(engine);

  // Render DOM immediately — no blank screen
  ui.render();

  // Audio engine + first sound on first user interaction
  const activate = () => {
    document.removeEventListener('pointerdown', activate);
    document.removeEventListener('keydown', activate);
    ui.activate();
  };

  document.addEventListener('pointerdown', activate);
  document.addEventListener('keydown', activate);
}

main();
