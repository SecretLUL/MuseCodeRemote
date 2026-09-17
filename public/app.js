document.addEventListener('DOMContentLoaded', () => {
  const terminalContainer = document.getElementById('terminalContainer');
  const pairingModal = document.getElementById('pairingModal');
  const helpModal = document.getElementById('helpModal');
  const tokenInput = document.getElementById('tokenInput');
  const connectForm = document.getElementById('connectForm');
  const connectFeedback = document.getElementById('connectFeedback');
  const btnSubmitToken = document.getElementById('btnSubmitToken');
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  const btnConnect = document.getElementById('btnConnect');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const btnFullscreen = document.getElementById('btnFullscreen');
  const btnHelp = document.getElementById('btnHelp');
  const btnCloseHelp = document.getElementById('btnCloseHelp');
  const btnCopyInstall = document.getElementById('btnCopyInstall');

  let ws = null;
  let currentToken = null;
  let term = null;
  let fitAddon = null;

  function showFeedback(text, type = '') {
    if (connectFeedback) {
      connectFeedback.textContent = text;
      connectFeedback.className = `connect-feedback ${type}`;
    }
  }

  function updateStatus(state, message) {
    statusIndicator.className = `status-pill status-${state}`;
    statusText.textContent = message;
  }

  try {
    const TerminalClass = window.Terminal || (window.xterm && window.xterm.Terminal);
    if (!TerminalClass) {
      throw new Error('Terminal class not loaded');
    }

    term = new TerminalClass({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Monaco, "Courier New", monospace',
      fontSize: 14,
      theme: {
        background: '#0b0f19',
        foreground: '#f3f4f6',
        cursor: '#818cf8',
        black: '#1f2937',
        red: '#ef4444',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#6366f1',
        magenta: '#d946ef',
        cyan: '#06b6d4',
        white: '#f9fafb',
        brightBlack: '#4b5563',
        brightRed: '#f87171',
        brightGreen: '#34d399',
        brightYellow: '#fbbf24',
        brightBlue: '#818cf8',
        brightMagenta: '#e879f9',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff'
      }
    });

    const FitClass = window.FitAddon ? (window.FitAddon.FitAddon || window.FitAddon) : null;
    if (FitClass) {
      fitAddon = new FitClass();
      term.loadAddon(fitAddon);
    }

    const LinksClass = window.WebLinksAddon ? (window.WebLinksAddon.WebLinksAddon || window.WebLinksAddon) : null;
    if (LinksClass) {
      term.loadAddon(new LinksClass());
    }

    term.open(terminalContainer);
    if (fitAddon) {
      setTimeout(() => fitAddon.fit(), 50);
    }
  } catch (err) {
    console.error('Failed to initialize xterm.js:', err);
    updateStatus('disconnected', 'Terminal Error');
    showFeedback('Could not initialize terminal component: ' + err.message, 'error');
  }

  function sendResize() {
    if (ws && ws.readyState === WebSocket.OPEN && term) {
      ws.send(JSON.stringify({
        type: 'resize',
        cols: term.cols,
        rows: term.rows
      }));
    }
  }

  window.addEventListener('resize', () => {
    if (fitAddon) fitAddon.fit();
    sendResize();
  });

  if (term) {
    term.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  }

  async function connectToDaemon(token) {
    if (!token) return;
    currentToken = token.trim();
    sessionStorage.setItem('mcr_token', currentToken);

    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set('token', currentToken);
    window.history.replaceState({}, '', newUrl.toString());

    btnSubmitToken.disabled = true;
    btnSubmitToken.textContent = 'Connecting...';
    showFeedback('Verifying session with relay...', 'loading');
    updateStatus('connecting', 'Connecting...');

    try {
      const res = await fetch(`/api/session/${encodeURIComponent(currentToken)}`);
      const data = await res.json();
      if (!data || !data.exists) {
        showFeedback('❌ Session token not found or daemon offline. Check your terminal.', 'error');
        updateStatus('disconnected', 'Invalid Token');
        btnSubmitToken.disabled = false;
        btnSubmitToken.textContent = 'Connect';
        return;
      }
    } catch (err) {
      console.warn('API session pre-check failed, proceeding to WS:', err);
    }

    showFeedback('Starting WebSocket stream...', 'loading');

    if (ws) {
      try { ws.close(); } catch (_) {}
    }

    if (term) {
      term.reset();
      term.write('\r\n Connecting to remote Muse Code session...\r\n');
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/client?token=${encodeURIComponent(currentToken)}`;

    ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      updateStatus('connected', 'Connected');
      showFeedback('Connected!', 'success');
      pairingModal.classList.add('hidden');
      btnSubmitToken.disabled = false;
      btnSubmitToken.textContent = 'Connect';
      if (term) {
        term.reset();
        if (fitAddon) fitAddon.fit();
        sendResize();
        term.focus();
      }
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          if (event.data.startsWith('{')) {
            const parsed = JSON.parse(event.data);
            if (parsed.type === 'daemon_disconnected') {
              if (term) term.write('\r\n\x1b[31m[MCR] The remote Muse Code daemon has disconnected.\x1b[0m\r\n');
              updateStatus('disconnected', 'Daemon Offline');
              showFeedback('Daemon has disconnected.', 'error');
              return;
            }
          }
        } catch (_) {}
        if (term) term.write(event.data);
      } else if (event.data instanceof ArrayBuffer) {
        if (term) term.write(new Uint8Array(event.data));
      }
    };

    ws.onerror = (e) => {
      console.error('WebSocket client error:', e);
      updateStatus('disconnected', 'Connection Error');
      showFeedback('WebSocket connection failed. Check proxy settings.', 'error');
      btnSubmitToken.disabled = false;
      btnSubmitToken.textContent = 'Connect';
    };

    ws.onclose = (event) => {
      updateStatus('disconnected', 'Disconnected');
      btnSubmitToken.disabled = false;
      btnSubmitToken.textContent = 'Connect';
      if (event.code === 4401 || event.code === 4404 || (event.reason && event.reason.includes('Session not found'))) {
        showFeedback('❌ Session token not found or expired.', 'error');
        pairingModal.classList.remove('hidden');
      } else if (event.code !== 1000) {
        if (term) term.write(`\r\n\x1b[33m[MCR] Connection closed (${event.code}). Click "Pair Session" to reconnect.\x1b[0m\r\n`);
      }
    };
  }

  connectForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const token = tokenInput.value.trim();
    if (token) {
      connectToDaemon(token);
    } else {
      showFeedback('Please enter a session token.', 'error');
    }
  });

  btnConnect.addEventListener('click', () => {
    tokenInput.value = currentToken || '';
    pairingModal.classList.remove('hidden');
    tokenInput.focus();
  });

  btnCloseModal.addEventListener('click', () => {
    pairingModal.classList.add('hidden');
  });

  btnHelp.addEventListener('click', () => {
    helpModal.classList.remove('hidden');
  });

  btnCloseHelp.addEventListener('click', () => {
    helpModal.classList.add('hidden');
  });

  pairingModal.addEventListener('click', (e) => {
    if (e.target === pairingModal) pairingModal.classList.add('hidden');
  });

  helpModal.addEventListener('click', (e) => {
    if (e.target === helpModal) helpModal.classList.add('hidden');
  });

  btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  btnCopyInstall.addEventListener('click', () => {
    const text = 'curl -fsSL https://raw.githubusercontent.com/SecretLUL/MuseCodeRemote/main/client/install.sh | bash';
    navigator.clipboard.writeText(text).then(() => {
      btnCopyInstall.textContent = '✓';
      setTimeout(() => { btnCopyInstall.textContent = '📋'; }, 2000);
    });
  });

  const urlParams = new URLSearchParams(window.location.search);
  const initialToken = urlParams.get('token') || sessionStorage.getItem('mcr_token');

  if (initialToken) {
    tokenInput.value = initialToken;
    connectToDaemon(initialToken);
  } else {
    pairingModal.classList.remove('hidden');
    tokenInput.focus();
  }
});
