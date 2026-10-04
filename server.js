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

// Генерация уникального ID
function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

io.on('connection', (socket) => {
  console.log('Игрок подключился:', socket.id);

  // Присваиваем ID при подключении
  const playerId = generateId();
  socket.emit('playerJoined', { id: playerId });

  // Игрок отправляет свои данные при входе в бой
  socket.on('joinGame', (playerData) => {
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
      active: true
    };
    
    players.set(playerId, player);
    
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

  // Выстрел
  socket.on('fire', (data) => {
    // Рассылаем всем кроме отправителя
    socket.broadcast.emit('projectileFired', data);
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

server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
