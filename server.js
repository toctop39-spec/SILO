'use strict';
/**
 * 2D War Strategy - сервер мультиплеера.
 *
 * Сервер намеренно "тонкий": он не считает физику, а надёжно раздаёт события.
 *   state      - состояние машины игрока (20 раз/с, volatile: устаревшие пакеты можно терять)
 *   fire       - выстрел (стартовые параметры снаряда)
 *   projEnd    - снаряд закончил полёт (попал / упал / взорвался)
 *   hit        - стрелок сообщил о попадании ТОЛЬКО жертве (урон применяет жертва)
 *   hitFx      - жертва возвращает стрелку надписи урона ("-120", "РИКОШЕТ"...)
 *   playerDeath/playerDied, playerJoined/playerRemoved, treeFall
 *
 * ID игрока = socket.id (раньше было два разных ID - из-за этого терялись попадания).
 */
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const ARENA = 'arena'; // комната: в ней только те, кто сейчас на полигоне (не в ангаре)

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
  pingInterval: 10000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1e5
});

app.disable('x-powered-by');
// Отдаём только игру (раньше express.static(__dirname) раздавал и server.js, и package.json)
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/healthz', (req, res) => res.send('ok'));

/** socket.id -> { id, x, y, a, cfg, alive, lastState } */
const players = new Map();
/** ключи деревьев, поваленных тяжёлой техникой (чтобы новичок видел тот же лес) */
const fallenTrees = new Set();

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const pub = p => ({ id: p.id, x: p.x, y: p.y, a: p.a, cfg: p.cfg });

function arenaIsEmpty() {
  const room = io.sockets.adapter.rooms.get(ARENA);
  return !room || room.size === 0;
}

io.on('connection', socket => {
  const id = socket.id;

  // Замер пинга
  socket.on('pingCheck', cb => { if (typeof cb === 'function') cb(); });

  // Игрок вышел на полигон (в том числе повторно - после смерти/ангара/переподключения)
  socket.on('joinGame', d => {
    if (!d || typeof d !== 'object' || !d.cfg || typeof d.cfg !== 'object' || !isNum(d.x) || !isNum(d.y)) return;
    const me = { id, x: d.x, y: d.y, a: isNum(d.a) ? d.a : 0, cfg: d.cfg, alive: true, lastState: 0 };
    players.set(id, me);

    // 1) новичку - всех живых, кто уже на полигоне, и поваленные деревья
    socket.emit('joined', {
      players: [...players.values()].filter(p => p.id !== id && p.alive).map(pub),
      trees: [...fallenTrees]
    });
    // 2) только после этого входим в комнату - так новичок не получит "state" раньше списка игроков
    socket.join(ARENA);
    // 3) остальным - что пришёл новый игрок
    socket.to(ARENA).emit('playerJoined', pub(me));
  });

  // Состояние машины (+ состояние самонаводящихся/баллистических ракет этого игрока)
  socket.on('state', d => {
    const p = players.get(id);
    if (!p || !d || typeof d !== 'object') return;
    const now = Date.now();
    if (now - p.lastState < 20) return; // не чаще 50 пакетов/с
    p.lastState = now;
    if (isNum(d.x) && isNum(d.y)) { p.x = d.x; p.y = d.y; if (isNum(d.a)) p.a = d.a; }
    d.id = id;
    socket.to(ARENA).volatile.emit('state', d);
  });

  // Выстрел
  socket.on('fire', d => {
    if (!players.has(id) || !d || typeof d.id !== 'string') return;
    d.owner = id;
    socket.to(ARENA).emit('fire', d);
  });

  // Снаряд закончил полёт
  socket.on('projEnd', d => {
    if (!players.has(id) || !d || typeof d.id !== 'string') return;
    socket.to(ARENA).emit('projEnd', d);
  });

  // Стрелок -> жертве: "ты получил попадание". Урон применяет сама жертва.
  socket.on('hit', d => {
    if (!players.has(id) || !d) return;
    const target = players.get(d.t);
    if (!target || !target.alive || d.t === id) return;
    if (![d.dmg, d.pen, d.lx, d.ly, d.pa].every(isNum)) return;
    io.to(d.t).emit('hit', {
      from: id,
      dmg: Math.max(0, Math.min(d.dmg, 3000)),
      pen: Math.max(0, Math.min(d.pen, 3000)),
      lx: d.lx, ly: d.ly, pa: d.pa,
      z: d.z === 'top' ? 'top' : null
    });
  });

  // Жертва -> стрелку: надписи урона
  socket.on('hitFx', d => {
    if (!players.has(id) || !d || typeof d.to !== 'string' || !Array.isArray(d.msgs)) return;
    io.to(d.to).emit('hitFx', { id, msgs: d.msgs.slice(0, 6) });
  });

  // Игрок уничтожен
  socket.on('playerDeath', d => {
    const p = players.get(id);
    if (!p || !p.alive) return;
    p.alive = false;
    socket.to(ARENA).emit('playerDied', {
      id,
      cause: String((d && d.cause) || 'hp').slice(0, 16),
      killer: d && typeof d.killer === 'string' ? d.killer : null
    });
  });

  // Дерево повалено тяжёлой техникой
  socket.on('treeFall', k => {
    if (!players.has(id) || typeof k !== 'string' || k.length > 24 || fallenTrees.has(k) || fallenTrees.size > 20000) return;
    fallenTrees.add(k);
    socket.to(ARENA).emit('treeFall', k);
  });

  function leave() {
    const p = players.get(id);
    if (p) {
      players.delete(id);
      // Если игрок уже погиб, его обломки догорят у всех сами - не убираем их резко
      if (p.alive) socket.to(ARENA).emit('playerRemoved', { id });
    }
    socket.leave(ARENA);
    if (arenaIsEmpty()) fallenTrees.clear();
  }
  socket.on('leaveGame', leave);
  socket.on('disconnect', leave);
});

server.listen(PORT, () => {
  console.log('Сервер запущен на порту ' + PORT);
});
