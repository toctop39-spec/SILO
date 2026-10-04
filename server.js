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

// База данных для ботов (соответствует клиентской DB)
const botDB = {
  hulls: [
    { id: 'h_buggy', name: 'Багги "Разведчик"', terrain: 'land', mass: 1500, hp: 320, armor: 10, drag: 0.92, size: {w: 25, l: 45}, drawType: 'car',
      mounts: [{id: 'm1', size: 1, x: 0, y: -5, name: 'Крыша'}, {id: 'm2', size: 1, x: 0, y: 14, name: 'Багажник'}] },
    { id: 'h_tank_med', name: 'Средний Танк Т-55', terrain: 'land', mass: 35000, hp: 800, armor: 60, drag: 0.88, size: {w: 40, l: 75}, drawType: 'tank',
      mounts: [{id: 'm1', size: 2, x: 0, y: -5, name: 'Главная башня'}] },
    { id: 'h_tank_heavy', name: 'Сверхтяжелый Танк', terrain: 'land', mass: 85000, hp: 2000, armor: 150, drag: 0.82, size: {w: 55, l: 100}, drawType: 'tank',
      mounts: [
          {id: 'm1', size: 3, x: 0, y: -20, name: 'Основая башня'}, 
          {id: 'm2', size: 1, x: 15, y: 25, name: 'Спонсон Пр.'},
          {id: 'm3', size: 1, x: -15, y: 25, name: 'Спонсон Лев.'}
      ]},
    { id: 'h_boat_patrol', name: 'Патрульный Катер', terrain: 'water', mass: 18000, hp: 750, armor: 25, drag: 0.96, size: {w: 30, l: 90}, drawType: 'boat',
      mounts: [
          {id: 'm1', size: 2, x: 0, y: -25, name: 'Нос'}, 
          {id: 'm2', size: 1, x: 0, y: 30, name: 'Корма'},
          {id: 'm3', size: 1, x: 12, y: 0, name: 'Пр. Борт'},
          {id: 'm4', size: 1, x: -12, y: 0, name: 'Лев. Борт'}
      ]},
    { id: 'h_cruiser', name: 'Ударный Крейсер', terrain: 'water', mass: 250000, hp: 5000, armor: 120, drag: 0.94, size: {w: 60, l: 220}, drawType: 'ship',
      mounts: [
          {id: 'm1', size: 3, x: 0, y: -70, name: 'ГК Нос'},
          {id: 'm2', size: 3, x: 0, y: 60, name: 'ГК Корма'},
          {id: 'm3', size: 2, x: 25, y: -10, name: 'Пр. Борт'},
          {id: 'm4', size: 2, x: -25, y: -10, name: 'Лев. Борт'}
      ]},
    { id: 'h_hover', name: 'Судно на Возд. Подушке', terrain: 'amphibious', mass: 12000, hp: 350, armor: 10, drag: 0.95, size: {w: 45, l: 70}, drawType: 'hover',
      mounts: [{id: 'm1', size: 2, x: 0, y: -10, name: 'Центр. Слот'}] }
  ],
  engines: [
    { id: 'e_gas', name: 'Бензиновый ДВС', mass: 500, power: 300000 },
    { id: 'e_diesel', name: 'Дизель V12', mass: 2500, power: 1200000 },
    { id: 'e_turbine', name: 'Газовая Турбина', mass: 1800, power: 2500000 },
    { id: 'e_reactor', name: 'Морской Реактор', mass: 25000, power: 15000000 }
  ],
  weapons: [
    { id: 'w_mg', name: 'Пулемет 12.7мм', size: 1, type: 'kinetic', mass: 200, dmg: 8, pen: 15, reload: 0.1, vel: 1200, range: 500, turn: 3.0, color: '#fbbf24', length: 15, barrelW: 2 },
    { id: 'w_atgm', name: 'ПТУР "Корнет"', size: 1, type: 'missile', mass: 350, dmg: 350, pen: 400, reload: 4.0, vel: 400, range: 1000, turn: 1.5, color: '#ef4444', length: 12, barrelW: 6, isTurreted: true },
    { id: 'w_auto30', name: 'Автопушка 30мм', size: 2, type: 'kinetic', mass: 1500, dmg: 25, pen: 45, reload: 0.25, vel: 1000, range: 700, turn: 2.0, color: '#fbbf24', length: 30, barrelW: 4 },
    { id: 'w_cannon76', name: 'Пушка 76мм', size: 2, type: 'kinetic', mass: 3000, dmg: 120, pen: 110, reload: 2.5, vel: 850, range: 900, turn: 1.2, color: '#f59e0b', length: 40, barrelW: 6 },
    { id: 'w_rocket_pod', name: 'РСЗО "Град" (блок)', size: 2, type: 'rocket', mass: 2000, dmg: 80, pen: 30, reload: 0.3, burst: 10, burstReload: 8.0, vel: 600, range: 1200, turn: 1.0, color: '#f97316', length: 20, barrelW: 15, isBox: true },
    { id: 'w_cannon152', name: 'Орудие 152мм', size: 3, type: 'kinetic', mass: 8000, dmg: 450, pen: 220, reload: 7.0, vel: 750, range: 1200, turn: 0.5, color: '#f59e0b', length: 60, barrelW: 9 },
    { id: 'w_naval', name: 'Морская Батарея (2х 203мм)', size: 3, type: 'kinetic', mass: 45000, dmg: 400, pen: 250, reload: 0.5, burst: 2, burstReload: 6.0, vel: 900, range: 2000, turn: 0.3, color: '#fbbf24', length: 70, barrelW: 8, dual: true },
    { id: 'w_cruise', name: 'Крылатая Ракета', size: 3, type: 'missile', mass: 12000, dmg: 1500, pen: 1000, reload: 15.0, vel: 300, range: 3000, turn: 0.5, color: '#ef4444', length: 40, barrelW: 12, isBox: true }
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
