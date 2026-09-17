const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.PORT || '8765', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DEFAULT_PUBLIC_URL = process.env.PUBLIC_URL || '';

const app = express();
const server = http.createServer(app);

const daemonWss = new WebSocketServer({ noServer: true });
const clientWss = new WebSocketServer({ noServer: true });

const sessions = new Map();

app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    activeSessions: sessions.size,
    uptime: process.uptime()
  });
});

app.get('/api/session/:token', (req, res) => {
  const token = req.params.token;
  const session = sessions.get(token);
  if (!session) {
    return res.status(404).json({ exists: false });
  }
  res.json({
    exists: true,
    hasClient: Boolean(session.clientWs),
    createdAt: session.createdAt
  });
});

app.get('/install.sh', (req, res) => {
  const filePath = path.join(__dirname, '../client/install.sh');
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('install.sh not found');
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.sendFile(filePath);
});

app.get('/run', (req, res) => {
  const filePath = path.join(__dirname, '../client/run.sh');
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('run.sh not found');
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.sendFile(filePath);
});

app.get('/client/mcr', (req, res) => {
  const filePath = path.join(__dirname, '../client/mcr');
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('mcr binary not found');
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.sendFile(filePath);
});

server.on('upgrade', (req, socket, head) => {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const url = new URL(req.url, `${proto}://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (pathname === '/ws/daemon') {
    console.log(`[WS Upgrade] /ws/daemon from ${clientIp}`);
    daemonWss.handleUpgrade(req, socket, head, (ws) => {
      daemonWss.emit('connection', ws, req);
    });
  } else if (pathname === '/ws/client') {
    const token = url.searchParams.get('token');
    console.log(`[WS Upgrade] /ws/client with token "${token}" from ${clientIp}`);
    if (!token || !sessions.has(token)) {
      console.warn(`[WS Denied] Token "${token}" not found. Active: ${Array.from(sessions.keys()).join(', ')}`);
      socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nSession not found or daemon offline\n');
      socket.destroy();
      return;
    }
    clientWss.handleUpgrade(req, socket, head, (ws) => {
      clientWss.emit('connection', ws, req, token);
    });
  } else {
    socket.destroy();
  }
});

function generateToken() {
  return `mcr-${crypto.randomBytes(3).toString('hex')}-${crypto.randomBytes(3).toString('hex')}`;
}

daemonWss.on('connection', (ws, req) => {
  let sessionToken = null;
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (message, isBinary) => {
    if (!isBinary) {
      try {
        const text = message.toString('utf8');
        if (text.startsWith('{')) {
          const parsed = JSON.parse(text);
          if (parsed.type === 'register') {
            sessionToken = parsed.token && /^[a-zA-Z0-9_-]{4,32}$/.test(parsed.token)
              ? parsed.token
              : generateToken();

            if (sessions.has(sessionToken)) {
              const old = sessions.get(sessionToken);
              try { old.daemonWs.close(4001, 'Replaced by new daemon'); } catch (_) {}
            }

            const hostHeader = req.headers.host || `localhost:${PORT}`;
            const proto = req.headers['x-forwarded-proto'] || 'http';
            const baseUrl = DEFAULT_PUBLIC_URL || `${proto}://${hostHeader}`;

            sessions.set(sessionToken, {
              daemonWs: ws,
              clientWs: null,
              createdAt: Date.now(),
              token: sessionToken
            });

            ws.send(JSON.stringify({
              type: 'registered',
              token: sessionToken,
              webUrl: `${baseUrl}/?token=${sessionToken}`,
              baseUrl
            }));
            return;
          }
        }
      } catch (_) {}
    }

    if (sessionToken && sessions.has(sessionToken)) {
      const session = sessions.get(sessionToken);
      if (session.clientWs && session.clientWs.readyState === ws.OPEN) {
        session.clientWs.send(message, { binary: isBinary });
      }
    }
  });

  ws.on('close', () => {
    if (sessionToken && sessions.has(sessionToken)) {
      const session = sessions.get(sessionToken);
      if (session.clientWs && session.clientWs.readyState === ws.OPEN) {
        session.clientWs.send(JSON.stringify({
          type: 'daemon_disconnected',
          message: 'The remote Muse Code daemon has disconnected.'
        }));
        session.clientWs.close(1000, 'Daemon disconnected');
      }
      sessions.delete(sessionToken);
    }
  });
});

clientWss.on('connection', (ws, req, token) => {
  const session = sessions.get(token);
  if (!session) {
    ws.close(4004, 'Session not found');
    return;
  }

  if (session.clientWs && session.clientWs !== ws) {
    try {
      session.clientWs.close(4002, 'Another browser session connected');
    } catch (_) {}
  }

  session.clientWs = ws;
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  if (session.daemonWs && session.daemonWs.readyState === ws.OPEN) {
    session.daemonWs.send(JSON.stringify({
      type: 'client_connected',
      token
    }));
  }

  ws.on('message', (message, isBinary) => {
    if (session.daemonWs && session.daemonWs.readyState === ws.OPEN) {
      session.daemonWs.send(message, { binary: isBinary });
    }
  });

  ws.on('close', () => {
    if (session.clientWs === ws) {
      session.clientWs = null;
      if (session.daemonWs && session.daemonWs.readyState === ws.OPEN) {
        session.daemonWs.send(JSON.stringify({
          type: 'client_disconnected',
          token
        }));
      }
    }
  });
});

const interval = setInterval(() => {
  for (const [token, session] of sessions.entries()) {
    if (session.daemonWs) {
      if (session.daemonWs.isAlive === false) {
        session.daemonWs.terminate();
        sessions.delete(token);
        continue;
      }
      session.daemonWs.isAlive = false;
      session.daemonWs.ping();
    }
    if (session.clientWs) {
      if (session.clientWs.isAlive === false) {
        session.clientWs.terminate();
        session.clientWs = null;
        continue;
      }
      session.clientWs.isAlive = false;
      session.clientWs.ping();
    }
  }
}, 25000);

server.on('close', () => {
  clearInterval(interval);
});

server.listen(PORT, HOST, () => {
  console.log(`MuseCodeRemote Relay listening on http://${HOST}:${PORT}`);
});
