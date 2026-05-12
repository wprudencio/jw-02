/**
 * UI — Builds and manages the brutalist terminal interface.
 *
 * Layout (centered single-column, same as original):
 *   - Noise + scanline overlays (fixed, global)
 *   - Top bar: logo + version
 *   - Hero section (centered flex column):
 *       Hash panel → Controls (generate, input, volume)
 *   - History panel (fixed, left side, bottom)
 *   - Status bar: terminal-style prompt
 *
 * Two-phase lifecycle:
 *   render()   — creates DOM + binds UI events (runs immediately)
 *   activate() — initializes audio engine + enables input (runs on first interaction)
 */
import { KeyboardController } from './KeyboardController.js';
import { MIDIController } from './MIDIController.js';

const WAVEFORM_BAR_COUNT = 48;

export class UI {
  constructor(engine) {
    this._engine = engine;
    this._keyboard = new KeyboardController(engine);
    this._midi = new MIDIController(engine);

    this._el = {};
    this._history = [];
    this._maxHistory = 20;
    this._pendingVolume = null;
    this._activationOverlay = null;

    /** @type {HTMLElement[]} */
    this._waveformBars = [];
  }

  /* ================================================================
   * Phase 1: Render DOM and bind UI events immediately on page load.
   * ================================================================ */
  render() {
    this._initTheme();
    this._createOverlays();
    this._createDOM();
    this._createOverlay();
    this._bindEvents();

    // Staggered reveal animation — fires after paint
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById('app').classList.add('reveal');
      });
    });
  }

  /* ================================================================
   * Phase 2: Initialize audio engine, generate first sound, enable input.
   * ================================================================ */
  async activate() {
    await this._engine.init();
    this._dismissOverlay();
    this._generate();
    this._keyboard.enable();

    const midiOk = await this._midi.init();
    this._updateMIDIIndicator(midiOk);

    if (this._pendingVolume !== null) {
      this._engine.setVolume(this._pendingVolume);
      this._pendingVolume = null;
    }

    this._updateStatusText('ACTIVE');
    setInterval(() => this._updateStatus(), 1000);
  }

  /* ================================================================
   * Global overlays (noise, scanlines)
   * ================================================================ */
  _createOverlays() {
    const glow = document.createElement('div');
    glow.id = 'glow-overlay';
    document.body.appendChild(glow);

    const noise = document.createElement('div');
    noise.id = 'noise-overlay';
    document.body.appendChild(noise);

    const scanlines = document.createElement('div');
    scanlines.id = 'scanlines-overlay';
    document.body.appendChild(scanlines);
  }

  /* ================================================================
   * Boot-sequence activation overlay
   * ================================================================ */
  _createOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'activation-overlay';

    const logo = document.createElement('div');
    logo.className = 'boot-logo';
    logo.textContent = 'JW-02';

    const log = document.createElement('div');
    log.className = 'boot-log';

    const logLines = [
      { text: '> INITIALIZING AUDIO SYSTEM...' },
      { text: '> MEMORY CHECK................ [<span class="ok">OK</span>]' },
      { text: '> OSCILLATOR ARRAY............ [<span class="ok">OK</span>]' },
      { text: '> SIGNAL CHAIN................ [<span class="ok">OK</span>]' },
      { text: '> VOICE POOL (16)............. [<span class="warn">READY</span>]' },
      { text: '> MIDI INTERFACE.............. [<span class="warn">SCANNING</span>]' },
    ];

    for (const line of logLines) {
      const el = document.createElement('div');
      el.className = 'line';
      el.innerHTML = line.text;
      log.appendChild(el);
    }

    const prompt = document.createElement('div');
    prompt.className = 'boot-prompt';
    prompt.textContent = 'PRESS ANY KEY TO ACTIVATE';

    overlay.appendChild(logo);
    overlay.appendChild(log);
    overlay.appendChild(prompt);

    document.body.appendChild(overlay);
    this._activationOverlay = overlay;
  }

  _dismissOverlay() {
    if (!this._activationOverlay) return;
    this._activationOverlay.classList.add('hidden');
    setTimeout(() => {
      if (this._activationOverlay?.parentNode) {
        this._activationOverlay.parentNode.removeChild(this._activationOverlay);
      }
      this._activationOverlay = null;
    }, 500);
  }

  /* ================================================================
   * Build the entire DOM tree (centered single-column layout)
   * ================================================================ */
  _createDOM() {
    const app = document.getElementById('app');

    /* ── Top Bar ── */
    const topBar = document.createElement('header');
    topBar.className = 'top-bar';

    const logo = document.createElement('span');
    logo.className = 'logo';
    logo.textContent = 'JW-02';

    const version = document.createElement('span');
    version.className = 'version-tag';
    version.textContent = 'V.01 — GEN-01';

    const themeToggle = document.createElement('button');
    themeToggle.className = 'theme-toggle';
    themeToggle.setAttribute('aria-label', 'Toggle theme');
    themeToggle.innerHTML = '<span class="theme-icon-dark">&#9788;</span><span class="theme-icon-light">&#9789;</span>';

    topBar.appendChild(logo);

    const topRight = document.createElement('div');
    topRight.className = 'top-bar-right';
    topRight.appendChild(themeToggle);
    topRight.appendChild(version);
    topBar.appendChild(topRight);
    app.appendChild(topBar);

    /* ── Hero ── */
    const hero = document.createElement('section');
    hero.className = 'hero';

    // --- Hash Panel ---
    const hashPanel = document.createElement('div');
    hashPanel.className = 'hash-panel';

    const hashLabel = document.createElement('div');
    hashLabel.className = 'hash-panel-label';
    hashLabel.textContent = 'SOUND IDENTITY';
    hashPanel.appendChild(hashLabel);

    const hashDisplay = document.createElement('div');
    hashDisplay.className = 'hash-display';
    hashDisplay.textContent = '--------';
    hashPanel.appendChild(hashDisplay);

    // Waveform decoration bars
    const waveform = document.createElement('div');
    waveform.className = 'waveform-deco';
    for (let i = 0; i < WAVEFORM_BAR_COUNT; i++) {
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.height = `${8 + Math.random() * 32}px`;
      this._waveformBars.push(bar);
      waveform.appendChild(bar);
    }
    hashPanel.appendChild(waveform);
    hero.appendChild(hashPanel);

    // --- Controls ---
    const controls = document.createElement('div');
    controls.className = 'controls';

    // Generate button
    const generateBtn = document.createElement('button');
    generateBtn.className = 'btn-generate';
    generateBtn.innerHTML = 'GENERATE<span class="key-hint">SHIFT</span>';
    controls.appendChild(generateBtn);

    // Hash input group
    const inputGroup = document.createElement('div');
    inputGroup.className = 'hash-input-group';

    const hashInput = document.createElement('input');
    hashInput.type = 'text';
    hashInput.className = 'hash-input';
    hashInput.placeholder = 'type anything in here…';
    hashInput.spellcheck = false;
    hashInput.autocomplete = 'off';

    const loadBtn = document.createElement('button');
    loadBtn.className = 'btn-load';
    loadBtn.textContent = 'LOAD';

    inputGroup.appendChild(hashInput);
    inputGroup.appendChild(loadBtn);
    controls.appendChild(inputGroup);

    // Volume control
    const volGroup = document.createElement('div');
    volGroup.className = 'volume-group';

    const volLabel = document.createElement('span');
    volLabel.className = 'volume-label';
    volLabel.textContent = 'VOLUME';

    const volSlider = document.createElement('input');
    volSlider.type = 'range';
    volSlider.className = 'volume-slider';
    volSlider.min = 0;
    volSlider.max = 100;
    volSlider.value = 70;

    const volValue = document.createElement('span');
    volValue.className = 'volume-value';
    volValue.textContent = '70%';

    volGroup.appendChild(volLabel);
    volGroup.appendChild(volSlider);
    volGroup.appendChild(volValue);
    controls.appendChild(volGroup);

    hero.appendChild(controls);
    app.appendChild(hero);

    /* ── History Toggle Button ── */
    const historyToggle = document.createElement('button');
    historyToggle.className = 'history-toggle';
    historyToggle.textContent = 'HISTORY';

    /* ── History (fixed side panel — hidden by default) ── */
    const historySection = document.createElement('div');
    historySection.className = 'history-section';

    const historyHeader = document.createElement('div');
    historyHeader.className = 'history-header';

    const historyLabelSpan = document.createElement('span');
    historyLabelSpan.textContent = 'HISTORY';

    const historyCount = document.createElement('span');
    historyCount.className = 'history-header-count';
    historyCount.textContent = '0';

    historyHeader.appendChild(historyLabelSpan);
    historyHeader.appendChild(historyCount);
    historySection.appendChild(historyHeader);

    // Scrollable list wrapper
    const historyList = document.createElement('div');
    historyList.className = 'history-list';
    historySection.appendChild(historyList);

    app.appendChild(historySection);
    app.appendChild(historyToggle);

    /* ── Status Bar ── */
    const statusBar = document.createElement('footer');
    statusBar.className = 'status-bar';

    const statusInd = document.createElement('div');
    statusInd.className = 'status-indicator';

    const promptSign = document.createElement('span');
    promptSign.className = 'status-prompt-sign';
    promptSign.textContent = '>';

    const statusText = document.createElement('span');
    statusText.className = 'status-text';
    statusText.textContent = 'STATUS: STANDBY';

    const statusCursor = document.createElement('span');
    statusCursor.className = 'status-cursor';
    statusCursor.textContent = '\u2588';

    const statusArrow = document.createElement('span');
    statusArrow.className = 'status-arrow';
    statusArrow.textContent = '\u25B6\u25B6\u25B6';

    statusInd.appendChild(promptSign);
    statusInd.appendChild(statusText);
    statusInd.appendChild(statusCursor);
    statusInd.appendChild(statusArrow);

    // Info row
    const infoRow = document.createElement('div');
    infoRow.className = 'info-row';

    // Keyboard info
    const kbInfo = document.createElement('span');
    kbInfo.className = 'info-item';
    kbInfo.innerHTML =
      '<span class="label">KB:</span>' +
      '<span class="value">A-K / Z/X</span>';
    infoRow.appendChild(kbInfo);

    // MIDI info
    const midiInfo = document.createElement('span');
    midiInfo.className = 'info-item midi-indicator';

    const midiLabel = document.createElement('span');
    midiLabel.className = 'label';
    midiLabel.textContent = 'MIDI:';
    midiInfo.appendChild(midiLabel);

    const midiLed = document.createElement('span');
    midiLed.className = 'midi-led disconnected';
    midiInfo.appendChild(midiLed);

    const midiStatus = document.createElement('span');
    midiStatus.className = 'value midi-status';
    midiStatus.textContent = 'SCANNING';
    midiInfo.appendChild(midiStatus);

    infoRow.appendChild(midiInfo);

    // Volume in status
    const volStatus = document.createElement('span');
    volStatus.className = 'info-item';
    volStatus.innerHTML =
      '<span class="label">VOL:</span>' +
      '<span class="value vol-status-value">70%</span>';
    infoRow.appendChild(volStatus);

    statusBar.appendChild(statusInd);
    statusBar.appendChild(infoRow);
    app.appendChild(statusBar);

    /* ── Store references ── */
    this._el = {
      hashDisplay,
      generateBtn,
      hashInput,
      loadBtn,
      statusText,
      statusCursor,
      midiLed,
      midiStatus,
      volSlider,
      volValue,
      historySection,
      historyList,
      historyCount,
      historyToggle,
      themeToggle,
      volStatusValue: volStatus.querySelector('.vol-status-value'),
    };
  }

  /* ================================================================
   * Event bindings
   * ================================================================ */
  _bindEvents() {
    // Theme toggle button
    this._el.themeToggle.addEventListener('click', () => this._toggleTheme());

    // History toggle button
    this._el.historyToggle.addEventListener('click', () => {
      const section = this._el.historySection;
      const isVisible = section.classList.toggle('visible');
      this._el.historyToggle.classList.toggle('active', isVisible);
    });

    // Generate button
    this._el.generateBtn.addEventListener('click', () => this._generate());

    // Shift key to generate (skip when in inputs)
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Shift') {
        this._generate();
        e.preventDefault();
      }
    });

    // Load hash
    this._el.loadBtn.addEventListener('click', () => this._loadHash());
    this._el.hashInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._loadHash();
    });

    // Click hash to copy
    this._el.hashDisplay.addEventListener('click', () => {
      const text = this._el.hashDisplay.textContent;
      navigator.clipboard.writeText(text).then(() => {
        this._updateStatusText('COPIED TO CLIPBOARD');
        setTimeout(() => this._updateStatusText('ACTIVE'), 2000);
      }).catch(() => {
        const range = document.createRange();
        range.selectNodeContents(this._el.hashDisplay);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      });
    });

    // Volume slider
    this._el.volSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      this._el.volValue.textContent = val + '%';

      if (this._el.volStatusValue) {
        this._el.volStatusValue.textContent = val + '%';
      }

      const vol = val / 100;
      if (this._engine.initialized) {
        this._engine.setVolume(vol);
      } else {
        this._pendingVolume = vol;
      }
    });
  }

  /* ================================================================
   * Generate / Load
   * ================================================================ */
  _generate() {
    if (!this._engine.initialized) {
      this._engine.init().then(() => this._doGenerate());
    } else {
      this._doGenerate();
    }
  }

  _doGenerate() {
    this._engine.resume();
    const hash = this._engine.generate();
    this._setHashDisplay(hash);
    this._el.hashInput.value = '';
    this._addToHistory(hash);
    this._updateStatusText(`ACTIVE — ${hash}`);
  }

  _loadHash() {
    const hash = this._el.hashInput.value.trim();
    if (!hash) return;

    if (!this._engine.initialized) {
      this._engine.init().then(() => this._doLoadHash(hash));
    } else {
      this._doLoadHash(hash);
    }
  }

  _doLoadHash(hash) {
    this._engine.resume();
    this._engine.loadHash(hash);
    const upper = hash.toUpperCase();
    this._setHashDisplay(upper);
    this._addToHistory(upper);
    this._updateStatusText(`LOADED — ${upper}`);
  }

  /**
   * Set the hash display text with a glitch animation.
   * @param {string} text
   */
  _setHashDisplay(text) {
    const el = this._el.hashDisplay;

    // Set data-text for glitch pseudo-elements
    el.setAttribute('data-text', text);
    el.textContent = text;

    // Trigger glitch
    el.classList.remove('glitch');
    void el.offsetWidth; // force reflow
    el.classList.add('glitch');

    // Clean up after animation
    setTimeout(() => el.classList.remove('glitch'), 520);

    // Update waveform bars with new random heights
    this._randomizeWaveform();
  }

  /**
   * Randomize the waveform decoration bar heights.
   */
  _randomizeWaveform() {
    for (const bar of this._waveformBars) {
      bar.style.height = `${6 + Math.random() * 34}px`;
    }
  }

  /* ================================================================
   * Theme
   * ================================================================ */

  /**
   * Initialize theme from localStorage or system preference.
   */
  _initTheme() {
    const stored = localStorage.getItem('jw02-theme');
    if (stored) {
      document.documentElement.setAttribute('data-theme', stored);
    } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  }

  /**
   * Toggle between dark and light theme.
   */
  _toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('jw02-theme', next);
  }

  /* ================================================================
   * History
   * ================================================================ */
  _addToHistory(hash) {
    this._history = this._history.filter(h => h !== hash);
    this._history.unshift(hash);
    if (this._history.length > this._maxHistory) {
      this._history.pop();
    }
    this._renderHistory();
  }

  _renderHistory() {
    const list = this._el.historyList;
    const currentHash = this._el.hashDisplay.textContent;

    // Clear list
    while (list.firstChild) {
      list.removeChild(list.firstChild);
    }

    for (const hash of this._history) {
      const item = document.createElement('div');
      item.className = 'history-item';
      if (hash === currentHash) {
        item.classList.add('active');
      }
      item.textContent = hash;
      item.addEventListener('click', () => {
        this._el.hashInput.value = hash;
        this._loadHash();
      });
      list.appendChild(item);
    }

    // Update count in header
    if (this._el.historyCount) {
      this._el.historyCount.textContent = String(this._history.length);
    }
  }

  /* ================================================================
   * Status bar
   * ================================================================ */
  _updateStatusText(text) {
    if (this._el.statusText) {
      this._el.statusText.textContent = `STATUS: ${text}`;
    }
  }

  _updateStatus() {
    const ctx = this._engine._ctx;
    if (ctx && ctx.state === 'suspended') {
      this._updateStatusText('SUSPENDED — CLICK TO ACTIVATE');
    }
  }

  /* ================================================================
   * MIDI indicator
   * ================================================================ */
  _updateMIDIIndicator(success) {
    const led = this._el.midiLed;
    const text = this._el.midiStatus;

    if (this._midi.connected) {
      led.className = 'midi-led connected';
      text.textContent = `${this._midi.deviceCount} DEV`;
    } else {
      led.className = 'midi-led disconnected';
      if (success === false) {
        text.textContent = 'DENIED';
      } else {
        text.textContent = 'NONE';
      }
    }
  }
}
