import { escapeHtml } from '../utils/html.js';

/**
 * Replaces `app` contents with the shell chrome; pages mount into the empty
 * #page-root section it creates.
 * @param {!Element} app
 * @param {{family: string, view: string}} state
 */
export function renderAppShell(app, state) {
  app.innerHTML = `
    <div class="app-shell">
      <header>
        <h1>Pokémon Pool Team Builder</h1>
      </header>

      <nav class="view-tabs">
        <button class="view-tab ${state.family === 'singles' ? 'active' : ''}" data-app-family="singles">Singles</button>
        <button class="view-tab ${state.family === 'doubles' ? 'active' : ''}" data-app-family="doubles">Doubles</button>
      </nav>

      <nav class="view-tabs secondary-tabs">
        <button class="view-tab ${state.view === 'resolver' ? 'active' : ''}" data-app-view="resolver">Set Lookup</button>
        <button class="view-tab ${state.view === 'pool' ? 'active' : ''}" data-app-view="pool">Team Builder</button>
        <button class="view-tab ${state.view === 'browser' ? 'active' : ''}" data-app-view="browser">Usage Data</button>
      </nav>

      <section id="page-root" class="page-stack"></section>
    </div>
  `;
}

/**
 * @param {!Element} app
 * @param {!Error} error
 */
export function renderFatalAppError(app, error) {
  app.innerHTML = `
    <div class="app-shell">
      <h1>Pokémon Pool Team Builder</h1>
      <p>Something broke while loading the app.</p>
      <pre>${escapeHtml(error.message)}</pre>
    </div>
  `;
}

