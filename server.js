const express = require('express');
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Статические файлы
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Хранилище игроков
const players = new Map();
const projectiles = new Map();

// Генерация уникального ID
function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

io.on('connection', (socket) => {
  console.log('Игрок подключился:', socket.id);

  // Создание нового игрока
  socket.on('joinGame', (playerData) => {
    const playerId = generateId();
    const player = {
      id: playerId,
      socketId: socket.id,
      x: playerData.x || 0,
      y: playerData.y || 0,
      angle: playerData.angle || 0,
      vx: 0,
      vy: 0,
      hull: playerData.hull,
      hp: playerData.hp,
      maxHp: playerData.maxHp,
      team: playerData.team || 1,
      config: playerData.config,
      weaponSystems: [],
      active: true
    };
    
    players.set(playerId, player);
    
    // Отправляем ID игроку
    socket.emit('playerJoined', { id: playerId });
    
    // Отправляем список всех игроков
    socket.emit('playersList', Array.from(players.values()));
    
    // Сообщаем всем о новом игроке
    socket.broadcast.emit('newPlayer', player);
    
    console.log('Игрок создан:', playerId);
  });

  // Синхронизация движения
  socket.on('playerUpdate', (data) => {
    const player = players.get(data.id);
    if (player) {
      player.x = data.x;
      player.y = data.y;
      player.angle = data.angle;
      player.vx = data.vx;
      player.vy = data.vy;
      
      // Рассылаем обновление всем кроме отправителя
      socket.broadcast.emit('playerMoved', {
        id: data.id,
        x: player.x,
        y: player.y,
        angle: player.angle,
        vx: player.vx,
        vy: player.vy
      });
    }
  });

  // Синхронизация оружия
  socket.on('weaponUpdate', (data) => {
    const player = players.get(data.playerId);
    if (player) {
      player.weaponSystems = data.weapons;
      socket.broadcast.emit('weaponSync', data);
    }
  });

  // Выстрел
  socket.on('fire', (data) => {
    const projectileId = generateId();
    const projectile = {
      id: projectileId,
      playerId: data.playerId,
      x: data.x,
      y: data.y,
      angle: data.angle,
      data: data.weaponData,
      team: data.team,
      active: true
    };
    
    projectiles.set(projectileId, projectile);
    
    // Рассылаем всем
    io.emit('projectileFired', projectile);
  });

  // Попадание/урон
  socket.on('hit', (data) => {
    const target = players.get(data.targetId);
    if (target) {
      target.hp = data.hp;
      target.mods = data.mods;
      target.flood = data.flood;
      target.fire = data.fire;
      
      io.emit('playerHit', {
        targetId: data.targetId,
        hp: target.hp,
        mods: target.mods,
        flood: target.flood,
        fire: target.fire
      });
    }
  });

  // Смерть игрока
  socket.on('playerDeath', (data) => {
    const player = players.get(data.id);
    if (player) {
      player.active = false;
      player.dead = data.cause;
      
      io.emit('playerDied', {
        id: data.id,
        cause: data.cause
      });
      
      // Удаляем через некоторое время
      setTimeout(() => {
        players.delete(data.id);
        io.emit('playerRemoved', { id: data.id });
      }, 5000);
    }
  });

  // Респавн
  socket.on('respawn', (data) => {
    const player = players.get(data.id);
    if (player) {
      player.x = data.x;
      player.y = data.y;
      player.angle = data.angle;
      player.hp = data.hp;
      player.maxHp = data.maxHp;
      player.active = true;
      player.dead = null;
      player.vx = 0;
      player.vy = 0;
      player.flood = 0;
      player.fire = false;
      player.mods = { engine: 1, tracks: 1, crew: 1 };
      
      io.emit('playerRespawned', {
        id: data.id,
        x: player.x,
        y: player.y,
        angle: player.angle,
        hp: player.hp,
        maxHp: player.maxHp
      });
    }
  });

  // Чат/сообщения
  socket.on('chatMessage', (data) => {
    io.emit('chatMessage', {
      playerId: data.playerId,
      message: data.message,
      timestamp: Date.now()
    });
  });

  // Отключение
  socket.on('disconnect', () => {
    console.log('Игрок отключился:', socket.id);
    
    // Находим и удаляем игрока
    for (const [id, player] of players) {
      if (player.socketId === socket.id) {
        players.delete(id);
        io.emit('playerRemoved', { id });
        break;
      }
    }
  });
});

// Очистка неактивных снарядов каждые 5 секунд
setInterval(() => {
  for (const [id, proj] of projectiles) {
    if (!proj.active) {
      projectiles.delete(id);
      io.emit('projectileRemoved', { id });
    }
  }
}, 5000);

server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
