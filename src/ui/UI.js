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
import { Arpeggiator } from '../synth/Arpeggiator.js';

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

    // ─── Arpeggiator Panel ───
    const arpPanel = document.createElement('div');
    arpPanel.className = 'arp-panel collapsed';

    // ARP header row
    const arpHeader = document.createElement('div');
    arpHeader.className = 'arp-header';

    const arpTitle = document.createElement('span');
    arpTitle.className = 'arp-title';
    arpTitle.textContent = 'ARPEGGIATOR';

    const arpToggle = document.createElement('button');
    arpToggle.className = 'arp-toggle';
    arpToggle.textContent = 'OFF';
    arpToggle.setAttribute('aria-label', 'Toggle arpeggiator');

    arpHeader.appendChild(arpTitle);
    arpHeader.appendChild(arpToggle);
    arpPanel.appendChild(arpHeader);

    // ARP controls row
    const arpControls = document.createElement('div');
    arpControls.className = 'arp-controls';

    // Pattern select
    const patternGroup = document.createElement('div');
    patternGroup.className = 'arp-control-group';

    const patternLabel = document.createElement('span');
    patternLabel.className = 'arp-control-label';
    patternLabel.textContent = 'PATTERN';

    const patternSelect = document.createElement('select');
    patternSelect.className = 'arp-select';
    const patternNames = Arpeggiator.patternNames;
    for (let i = 0; i < patternNames.length; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = patternNames[i];
      patternSelect.appendChild(opt);
    }

    patternGroup.appendChild(patternLabel);
    patternGroup.appendChild(patternSelect);
    arpControls.appendChild(patternGroup);

    // BPM control
    const bpmGroup = document.createElement('div');
    bpmGroup.className = 'arp-control-group';

    const bpmLabel = document.createElement('span');
    bpmLabel.className = 'arp-control-label';
    bpmLabel.textContent = 'BPM';

    const bpmValue = document.createElement('span');
    bpmValue.className = 'arp-value';
    bpmValue.textContent = '140';

    const bpmSlider = document.createElement('input');
    bpmSlider.type = 'range';
    bpmSlider.className = 'arp-slider';
    bpmSlider.min = 40;
    bpmSlider.max = 300;
    bpmSlider.value = 140;

    bpmGroup.appendChild(bpmLabel);
    bpmGroup.appendChild(bpmSlider);
    bpmGroup.appendChild(bpmValue);
    arpControls.appendChild(bpmGroup);

    // Rate (divisor) control
    const rateGroup = document.createElement('div');
    rateGroup.className = 'arp-control-group';

    const rateLabel = document.createElement('span');
    rateLabel.className = 'arp-control-label';
    rateLabel.textContent = 'RATE';

    const rateSelect = document.createElement('select');
    rateSelect.className = 'arp-select';
    rateSelect.innerHTML = `
      <option value="1/4">1/4</option>
      <option value="1/8" selected>1/8</option>
      <option value="1/8T">1/8T</option>
      <option value="1/16">1/16</option>
      <option value="1/16T">1/16T</option>
      <option value="1/32">1/32</option>
    `;

    rateGroup.appendChild(rateLabel);
    rateGroup.appendChild(rateSelect);
    arpControls.appendChild(rateGroup);

    // Gate control
    const gateGroup = document.createElement('div');
    gateGroup.className = 'arp-control-group';

    const gateLabel = document.createElement('span');
    gateLabel.className = 'arp-control-label';
    gateLabel.textContent = 'GATE';

    const gateValue = document.createElement('span');
    gateValue.className = 'arp-value';
    gateValue.textContent = '50%';

    const gateSlider = document.createElement('input');
    gateSlider.type = 'range';
    gateSlider.className = 'arp-slider';
    gateSlider.min = 5;
    gateSlider.max = 100;
    gateSlider.value = 50;

    gateGroup.appendChild(gateLabel);
    gateGroup.appendChild(gateSlider);
    gateGroup.appendChild(gateValue);
    arpControls.appendChild(gateGroup);

    // Octave expand control
    const octGroup = document.createElement('div');
    octGroup.className = 'arp-control-group';

    const octLabel = document.createElement('span');
    octLabel.className = 'arp-control-label';
    octLabel.textContent = 'OCT';

    const octBtns = document.createElement('div');
    octBtns.className = 'arp-oct-btns';

    for (let n = 1; n <= 3; n++) {
      const btn = document.createElement('button');
      btn.className = 'arp-oct-btn' + (n === 1 ? ' active' : '');
      btn.textContent = String(n);
      btn.dataset.oct = String(n);
      octBtns.appendChild(btn);
    }

    octGroup.appendChild(octLabel);
    octGroup.appendChild(octBtns);
    arpControls.appendChild(octGroup);

    arpPanel.appendChild(arpControls);
    controls.appendChild(arpPanel);

    hero.appendChild(controls);
    app.appendChild(hero);

    /* ── History Toggle Button ── */
    const historyToggle = document.createElement('button');
    historyToggle.className = 'history-toggle';
    historyToggle.textContent = 'HISTORY';

    /* ── ARP Panel Toggle ── */
    const arpVisToggle = document.createElement('button');
    arpVisToggle.className = 'arp-vis-toggle';
    arpVisToggle.textContent = 'ARP';

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
    app.appendChild(arpVisToggle);

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

    // ARP info
    const arpInfo = document.createElement('span');
    arpInfo.className = 'info-item arp-info';
    const arpLabel = document.createElement('span');
    arpLabel.className = 'label';
    arpLabel.textContent = 'ARP:';
    arpInfo.appendChild(arpLabel);
    const arpLedEl = document.createElement('span');
    arpLedEl.className = 'arp-led off';
    arpInfo.appendChild(arpLedEl);
    const arpStatusText = document.createElement('span');
    arpStatusText.className = 'value arp-status-text';
    arpStatusText.textContent = 'OFF';
    arpInfo.appendChild(arpStatusText);
    infoRow.appendChild(arpInfo);

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
      arpVisToggle,
      themeToggle,
      volStatusValue: volStatus.querySelector('.vol-status-value'),
      arpToggle,
      patternSelect,
      bpmSlider,
      bpmValue,
      rateSelect,
      gateSlider,
      gateValue,
      octBtns,
      arpLedEl,
      arpStatusText,
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

    // ARP panel visibility toggle
    this._el.arpVisToggle.addEventListener('click', () => {
      const panel = document.querySelector('.arp-panel');
      if (!panel) return;
      const isHidden = panel.classList.toggle('collapsed');
      this._el.arpVisToggle.classList.toggle('active', !isHidden);
      this._el.arpVisToggle.textContent = isHidden ? 'ARP' : 'ARP';
      // Blink to indicate state change
      this._el.arpVisToggle.classList.add('blink');
      setTimeout(() => this._el.arpVisToggle.classList.remove('blink'), 300);
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
    this._el.loadBtn.addEventListener('click', () => {
      this._loadHash();
      this._el.hashInput.blur();
    });
    this._el.hashInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this._loadHash();
        e.target.blur();
      }
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
    this._el.volSlider.addEventListener('change', () => {
      this._el.volSlider.blur();
    });

    // ── Arpeggiator events ──
    this._el.arpToggle.addEventListener('click', () => {
      const arp = this._engine.arp;
      const isActive = !arp.active;
      arp.setActive(isActive);
      this._el.arpToggle.textContent = isActive ? 'ON' : 'OFF';
      this._el.arpToggle.classList.toggle('active', isActive);
      this._updateArpStatus();
      this._updateStatusText(isActive ? `ARP ON — ${arp.patternName}` : 'ACTIVE');
    });

    this._el.patternSelect.addEventListener('change', (e) => {
      const arp = this._engine.arp;
      arp.setPattern(parseInt(e.target.value, 10));
      this._updateArpStatus();
      if (arp.active) {
        this._updateStatusText(`ARP — ${arp.patternName}`);
      }
      e.target.blur();
    });

    this._el.bpmSlider.addEventListener('input', (e) => {
      const bpm = parseInt(e.target.value, 10);
      this._engine.arp.setBPM(bpm);
      this._el.bpmValue.textContent = String(bpm);
    });
    this._el.bpmSlider.addEventListener('change', (e) => {
      e.target.blur();
    });

    this._el.rateSelect.addEventListener('change', (e) => {
      this._engine.arp.setDivisorKey(e.target.value);
      e.target.blur();
    });

    this._el.gateSlider.addEventListener('input', (e) => {
      const pct = parseInt(e.target.value, 10);
      this._engine.arp.setGate(pct / 100);
      this._el.gateValue.textContent = pct + '%';
    });
    this._el.gateSlider.addEventListener('change', (e) => {
      e.target.blur();
    });

    this._el.octBtns.addEventListener('click', (e) => {
      const btn = e.target.closest('.arp-oct-btn');
      if (!btn) return;
      const oct = parseInt(btn.dataset.oct, 10);
      this._engine.arp.setOctaveExpand(oct);
      // Update active state
      for (const b of this._el.octBtns.querySelectorAll('.arp-oct-btn')) {
        b.classList.toggle('active', parseInt(b.dataset.oct, 10) === oct);
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

  _updateArpStatus() {
    const arp = this._engine.arp;
    if (this._el.arpLedEl) {
      this._el.arpLedEl.className = `arp-led ${arp.active ? 'on' : 'off'}`;
    }
    if (this._el.arpStatusText) {
      this._el.arpStatusText.textContent = arp.active ? arp.patternName : 'OFF';
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
