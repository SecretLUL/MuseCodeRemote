document.addEventListener('DOMContentLoaded', () => {
  const terminalContainer = document.getElementById('terminalContainer');
  const pairingModal = document.getElementById('pairingModal');
  const helpModal = document.getElementById('helpModal');
  const tokenInput = document.getElementById('tokenInput');
  const connectForm = document.getElementById('connectForm');
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

  const term = new Terminal({
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

  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  if (typeof WebLinksAddon !== 'undefined' && WebLinksAddon.WebLinksAddon) {
    term.loadAddon(new WebLinksAddon.WebLinksAddon());
  }

  term.open(terminalContainer);
  fitAddon.fit();

  function updateStatus(state, message) {
    statusIndicator.className = `status-pill status-${state}`;
    statusText.textContent = message;
  }

  function sendResize() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'resize',
        cols: term.cols,
        rows: term.rows
      }));
    }
  }

  window.addEventListener('resize', () => {
    fitAddon.fit();
    sendResize();
  });

  term.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  function connectToDaemon(token) {
    if (!token) return;
    currentToken = token.trim();
    sessionStorage.setItem('mcr_token', currentToken);

    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set('token', currentToken);
    window.history.replaceState({}, '', newUrl.toString());

    if (ws) {
      try { ws.close(); } catch (_) {}
    }

    updateStatus('connecting', 'Connecting...');
    term.reset();
    term.write('\r\n Connecting to remote Muse Code session...\r\n');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/client?token=${encodeURIComponent(currentToken)}`;

    ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      updateStatus('connected', 'Connected');
      pairingModal.classList.add('hidden');
      term.reset();
      fitAddon.fit();
      sendResize();
      term.focus();
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          if (event.data.startsWith('{')) {
            const parsed = JSON.parse(event.data);
            if (parsed.type === 'daemon_disconnected') {
              term.write('\r\n\x1b[31m[MCR] The remote Muse Code daemon has disconnected.\x1b[0m\r\n');
              updateStatus('disconnected', 'Daemon Offline');
              return;
            }
          }
        } catch (_) {}
        term.write(event.data);
      } else if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data));
      }
    };

    ws.onerror = () => {
      updateStatus('disconnected', 'Connection Error');
    };

    ws.onclose = (event) => {
      updateStatus('disconnected', 'Disconnected');
      if (event.code === 4401 || event.code === 4404 || event.reason.includes('Session not found')) {
        term.write('\r\n\x1b[31m[MCR] Session not found or daemon offline. Please check your token.\x1b[0m\r\n');
        pairingModal.classList.remove('hidden');
      } else if (event.code !== 1000) {
        term.write(`\r\n\x1b[33m[MCR] Connection closed (${event.code}). Click "Pair Session" to reconnect.\x1b[0m\r\n`);
      }
    };
  }

  connectForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const token = tokenInput.value.trim();
    if (token) {
      connectToDaemon(token);
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
