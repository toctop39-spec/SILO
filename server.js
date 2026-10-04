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
const bots = new Map();

// База данных для ботов (упрощенная версия клиентской DB)
const botDB = {
  hulls: [
    { id: 'h_buggy', name: 'Багги', terrain: 'land', mass: 1500, hp: 320, armor: 10, size: {w: 25, l: 45}, drawType: 'car',
      mounts: [{id: 'm1', size: 1, x: 0, y: -5}, {id: 'm2', size: 1, x: 0, y: 14}] },
    { id: 'h_tank_med', name: 'Танк Т-55', terrain: 'land', mass: 35000, hp: 800, armor: 60, size: {w: 40, l: 75}, drawType: 'tank',
      mounts: [{id: 'm1', size: 2, x: 0, y: -5}] },
    { id: 'h_tank_heavy', name: 'Тяжёлый танк', terrain: 'land', mass: 85000, hp: 2000, armor: 150, size: {w: 55, l: 100}, drawType: 'tank',
      mounts: [{id: 'm1', size: 3, x: 0, y: -5}] },
    { id: 'h_boat_patrol', name: 'Патрульный катер', terrain: 'water', mass: 8000, hp: 450, armor: 20, size: {w: 25, l: 55}, drawType: 'boat',
      mounts: [{id: 'm1', size: 1, x: 0, y: -5}] }
  ],
  engines: [
    { id: 'e1', name: 'Базовый', power: 150, mass: 200 },
    { id: 'e2', name: 'Средний', power: 400, mass: 600 },
    { id: 'e3', name: 'Мощный', power: 800, mass: 1200 }
  ],
  weapons: [
    { id: 'w_mg', name: 'Пулемёт', size: 1, type: 'kinetic', mass: 200, dmg: 15, pen: 10, reload: 0.1, vel: 900, range: 800, turn: 15, color: '#fbbf24', length: 8, barrelW: 3 },
    { id: 'w_auto30', name: 'Автопушка 30мм', size: 2, type: 'kinetic', mass: 800, dmg: 45, pen: 40, reload: 0.15, vel: 1000, range: 1500, turn: 10, color: '#fbbf24', length: 12, barrelW: 5 },
    { id: 'w_cannon76', name: 'Пушка 76мм', size: 2, type: 'kinetic', mass: 1500, dmg: 120, pen: 80, reload: 2.5, vel: 700, range: 2000, turn: 8, color: '#fbbf24', length: 14, barrelW: 6 },
    { id: 'w_cannon152', name: 'Гаубица 152мм', size: 3, type: 'kinetic', mass: 4000, dmg: 350, pen: 150, reload: 5, vel: 600, range: 3000, turn: 5, color: '#fbbf24', length: 18, barrelW: 8 }
  ]
};

// Генерация уникального ID
function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

// Создание бота
function createBot() {
  const botId = 'bot_' + generateId();
  const hull = botDB.hulls[Math.floor(Math.random() * botDB.hulls.length)];
  const engine = botDB.engines[Math.floor(Math.random() * botDB.engines.length)];
  
  const weapons = {};
  hull.mounts.forEach(m => {
    const possibleWeps = botDB.weapons.filter(w => w.size <= m.size);
    weapons[m.id] = possibleWeps[Math.floor(Math.random() * possibleWeps.length)];
  });

  const bot = {
    id: botId,
    x: (Math.random() - 0.5) * 4000,
    y: (Math.random() - 0.5) * 4000,
    angle: Math.random() * Math.PI * 2,
    vx: 0,
    vy: 0,
    hull: hull,
    hp: hull.hp,
    maxHp: hull.hp,
    team: 2,
    config: { hull, engine, weapons },
    active: true,
    isBot: true,
    targetAngle: Math.random() * Math.PI * 2,
    lastFire: 0
  };
  
  bots.set(botId, bot);
  return bot;
}

// Инициализация ботов при запуске
for (let i = 0; i < 5; i++) {
  createBot();
}

// Обновление ботов (простой AI)
function updateBots(dt) {
  for (const [id, bot] of bots) {
    if (!bot.active || bot.hp <= 0) continue;
    
    // Простое движение
    bot.targetAngle += (Math.random() - 0.5) * 0.1;
    const diff = bot.targetAngle - bot.angle;
    bot.angle += Math.sign(diff) * Math.min(Math.abs(diff), 0.5 * dt);
    
    bot.vx = Math.cos(bot.angle) * 50;
    bot.vy = Math.sin(bot.angle) * 50;
    bot.x += bot.vx * dt;
    bot.y += bot.vy * dt;
    
    // Ограничение карты
    if (Math.abs(bot.x) > 4000) bot.x = Math.sign(bot.x) * 4000;
    if (Math.abs(bot.y) > 4000) bot.y = Math.sign(bot.y) * 4000;
    
    // Случайная стрельба
    if (Date.now() - bot.lastFire > 3000 && Math.random() < 0.01) {
      bot.lastFire = Date.now();
      // Создаём снаряд от бота
      const weapon = Object.values(bot.config.weapons)[0];
      if (weapon) {
        const projectileId = generateId();
        const projectile = {
          id: projectileId,
          playerId: bot.id,
          x: bot.x + Math.cos(bot.angle) * 50,
          y: bot.y + Math.sin(bot.angle) * 50,
          angle: bot.angle,
          weaponData: weapon,
          team: bot.team,
          active: true
        };
        projectiles.set(projectileId, projectile);
        io.emit('projectileFired', projectile);
      }
    }
  }
}

// Рассылка состояния ботов клиентам
function broadcastBots() {
  const botData = Array.from(bots.values()).map(b => ({
    id: b.id,
    x: b.x,
    y: b.y,
    angle: b.angle,
    vx: b.vx,
    vy: b.vy,
    hull: b.hull,
    hp: b.hp,
    maxHp: b.maxHp,
    team: b.team,
    config: b.config,
    active: b.active
  }));
  io.emit('botsUpdate', botData);
}

// Игровой цикл сервера (обновление ботов)
setInterval(() => {
  updateBots(0.1);
  broadcastBots();
}, 100);

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
