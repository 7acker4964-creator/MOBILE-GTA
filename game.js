// Simple mobile GTA-like prototype (Phaser 3)
// - generated textures so it runs without external assets
// - virtual joystick support (rex plugin), keyboard fallback
// - simple mission: kill 3 enemies

const config = {
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  parent: 'game-container',
  backgroundColor: '#2b2b2b',
  physics: {
    default: 'arcade',
    arcade: { gravity: { y: 0 }, debug: false }
  },
  scene: [MenuScene, GameScene, MissionScene],
  plugins: {
    global: [{
      key: 'rexVirtualJoystick',
      plugin: rexvirtualjoystickplugin,
      start: true
    }]
  }
};

// Global-ish game state (keeps UI simple)
let playerHealth = 100;
let score = 0;
let inventory = { ammo: 10, fuel: 100 };
let currentMission = null;

class MenuScene extends Phaser.Scene {
  constructor() { super('MenuScene'); }
  create() {
    const w = this.scale.width, h = this.scale.height;
    this.add.text(w/2, h*0.25, 'Mobile GTA-Lite', { fontSize: '36px', color:'#fff' }).setOrigin(0.5);
    const start = this.add.text(w/2, h*0.55, 'Tap to Start', { fontSize: '24px', color:'#fff' }).setOrigin(0.5).setInteractive({useHandCursor:true});
    start.on('pointerdown', () => {
      this.scene.start('GameScene');
    });
    this.add.text(w/2, h*0.75, 'Use the joystick (or arrow keys) to move.\nTap red button to shoot.', { fontSize:'16px', color:'#ddd', align:'center' }).setOrigin(0.5);
  }
}

class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  preload() {
    // No external assets required: create simple textures in runtime.
  }

  create() {
    const w = this.scale.width, h = this.scale.height;

    // Create simple textures (car, enemy, bullet, building, fuel)
    const g = this.make.graphics({x:0, y:0, add:false});

    // Car (player)
    g.clear();
    g.fillStyle(0x0077ff, 1);
    g.fillRoundedRect(0, 0, 48, 28, 6);
    g.generateTexture('car', 48, 28);

    // Enemy
    g.clear();
    g.fillStyle(0xff4444, 1);
    g.fillCircle(14, 14, 14);
    g.generateTexture('enemy', 28, 28);

    // Bullet
    g.clear();
    g.fillStyle(0xffff88, 1);
    g.fillRect(0, 0, 8, 4);
    g.generateTexture('bullet', 8, 4);

    // Building (background)
    g.clear();
    g.fillStyle(0x333333, 1);
    g.fillRect(0, 0, 64, 64);
    g.fillStyle(0x555555, 1);
    for (let y=8; y<56; y+=12) for (let x=8; x<56; x+=12) g.fillRect(x,y,6,8);
    g.generateTexture('building', 64, 64);

    // Fuel
    g.clear();
    g.fillStyle(0x88ff88, 1);
    g.fillRect(0,0,20,20);
    g.fillStyle(0x006600,1);
    g.fillRect(4,4,12,12);
    g.generateTexture('fuel', 20, 20);

    // Background city: scatter some building sprites
    this.bgGroup = this.add.group();
    for (let i = 0; i < 25; i++) {
      const bx = Phaser.Math.Between(0, w);
      const by = Phaser.Math.Between(0, h);
      const b = this.add.image(bx, by, 'building');
      b.setAlpha(0.55);
      b.setDepth(-1);
    }

    // Player
    this.player = this.physics.add.sprite(w/2, h/2, 'car');
    this.player.setCollideWorldBounds(true);
    this.player.setDrag(400, 400);
    this.player.setDamping(true);
    this.player.setMaxVelocity(250);

    // Groups: enemies, fuels, bullets
    this.enemies = this.physics.add.group();
    this.fuels = this.physics.add.group();
    this.bullets = this.physics.add.group();

    this.spawnEnemies(5);
    this.spawnFuels(3);

    // Controls: virtual joystick by rex plugin; fallback to cursors
    this.joystick = null;
    if (this.plugins.has('rexVirtualJoystick')) {
      this.joystick = this.plugins.get('rexVirtualJoystick').add(this, {
        x: 90,
        y: h - 90,
        radius: 60,
        base: this.add.circle(0, 0, 60, 0x666666, 0.35),
        thumb: this.add.circle(0, 0, 30, 0xcccccc, 0.35)
      });
    }
    this.cursors = this.input.keyboard.createCursorKeys();

    // Shoot button (touch)
    this.shootButton = this.add.circle(w - 80, h - 80, 40, 0xff4444, 0.9).setInteractive({useHandCursor:true});
    this.shootButton.on('pointerdown', () => this.shoot());
    this.shootButton.setScrollFactor(0);

    // UI text
    this.healthText = this.add.text(12, 12, `Health: ${playerHealth}`, { fontSize: '18px', color:'#fff' }).setDepth(20);
    this.scoreText = this.add.text(12, 36, `Score: ${score}`, { fontSize: '18px', color:'#fff' }).setDepth(20);
    this.inventoryText = this.add.text(12, 60, `Ammo: ${inventory.ammo} Fuel: ${inventory.fuel}`, { fontSize: '16px', color:'#fff' }).setDepth(20);

    // Start mission
    this.startMission();

    // Collisions & overlaps
    this.physics.add.collider(this.enemies, this.enemies);
    this.physics.add.collider(this.player, this.enemies, this.hitEnemy, null, this);
    this.physics.add.collider(this.bullets, this.enemies, this.destroyEnemy, null, this);
    this.physics.add.overlap(this.player, this.fuels, this.collectFuel, null, this);

    // For bullets leaving screen
    this.physics.world.on('worldbounds', (body) => {
      if (body.gameObject && body.gameObject.destroy) body.gameObject.destroy();
    });

    // small state for last shot direction
    this.lastRotation = 0;

    // Time accumulator for fuel drain
    this._fuelAccumulator = 0;
  }

  update(time, delta) {
    // Controls input -> velocity
    let vx = 0, vy = 0;
    if (this.joystick) {
      const force = this.joystick.force; // vector with x,y ([-1,1] scaled)
      vx = force.x * 220;
      vy = force.y * 220;
      if (force.x !== 0 || force.y !== 0) {
        this.lastRotation = Math.atan2(force.y, force.x);
        this.player.rotation = this.lastRotation;
      }
    } else {
      // keyboard fallback
      if (this.cursors.left.isDown) vx = -200;
      else if (this.cursors.right.isDown) vx = 200;
      if (this.cursors.up.isDown) vy = -200;
      else if (this.cursors.down.isDown) vy = 200;
      if (vx !== 0 || vy !== 0) {
        this.lastRotation = Math.atan2(vy, vx);
        this.player.rotation = this.lastRotation;
      }
      if (this.cursors.space && Phaser.Input.Keyboard.JustDown(this.cursors.space)) this.shoot();
    }

    // apply velocity smoothly
    this.player.setVelocity(vx, vy);

    // Update UI
    this.healthText.setText(`Health: ${playerHealth}`);
    this.scoreText.setText(`Score: ${score}`);
    this.inventoryText.setText(`Ammo: ${inventory.ammo} Fuel: ${Math.max(0, Math.floor(inventory.fuel))}`);

    // Mission check
    if (currentMission && this.checkMissionComplete()) {
      this.completeMission();
    }

    // Fuel drain while moving
    const moving = Math.abs(vx) > 1 || Math.abs(vy) > 1;
    this._fuelAccumulator += delta;
    if (this._fuelAccumulator >= 1000) {
      // drain 1 fuel per second while moving, else 0.2
      inventory.fuel = Math.max(0, inventory.fuel - (moving ? 1 : 0.2));
      this._fuelAccumulator = 0;
    }

    // Low fuel warning (single floating text)
    if (inventory.fuel <= 20 && !this._lowFuelText) {
      this._lowFuelText = this.add.text(this.scale.width/2, this.scale.height/2, 'Low Fuel!', { fontSize:'28px', color:'#ff4444' }).setOrigin(0.5).setDepth(30);
      this.time.delayedCall(1500, () => { if (this._lowFuelText) { this._lowFuelText.destroy(); this._lowFuelText = null; }});
    }

    // Remove bullets out of bounds manually (safety)
    this.bullets.getChildren().forEach(b => {
      if (!this.cameras.main.worldView.contains(b.x, b.y)) {
        b.destroy();
      }
    });

    // simple enemy AI: wander and sometimes chase player
    this.enemies.getChildren().forEach(enemy => {
      if (!enemy.active) return;
      if (Phaser.Math.Between(0, 1000) > 995) {
        // change velocity randomly
        enemy.setVelocity(Phaser.Math.Between(-120, 120), Phaser.Math.Between(-120, 120));
      }
      // small chance to chase player
      if (Phaser.Math.Between(0, 1000) > 995) {
        this.physics.moveToObject(enemy, this.player, 90);
      }
    });

    // Check game over
    if (playerHealth <= 0) {
      score = 0;
      inventory.ammo = 10;
      inventory.fuel = 100;
      playerHealth = 100;
      this.scene.start('MenuScene');
    }
  }

  shoot() {
    if (inventory.ammo <= 0) {
      // no ammo
      return;
    }
    inventory.ammo--;
    const bullet = this.physics.add.sprite(this.player.x, this.player.y, 'bullet');
    bullet.setDepth(15);
    bullet.body.setAllowGravity(false);
    bullet.body.setCollideWorldBounds(true);
    bullet.body.onWorldBounds = true;
    const speed = 420;
    bullet.setVelocity(Math.cos(this.player.rotation) * speed, Math.sin(this.player.rotation) * speed);
    bullet.rotation = this.player.rotation;
    // small lifespan
    this.time.delayedCall(2000, () => { if (bullet && bullet.destroy) bullet.destroy(); });
    // mobile haptic if available
    try { if (navigator.vibrate) navigator.vibrate(40); } catch (e) {}
    this.bullets.add(bullet);
  }

  spawnEnemies(count) {
    for (let i=0;i<count;i++) {
      const ex = Phaser.Math.Between(50, this.scale.width-50);
      const ey = Phaser.Math.Between(50, this.scale.height-50);
      const enemy = this.enemies.create(ex, ey, 'enemy');
      enemy.setCollideWorldBounds(true);
      enemy.setBounce(1);
      enemy.setVelocity(Phaser.Math.Between(-100, 100), Phaser.Math.Between(-100, 100));
      enemy.health = 50;
    }
  }

  spawnFuels(count) {
    for (let i=0;i<count;i++) {
      const fx = Phaser.Math.Between(40, this.scale.width-40);
      const fy = Phaser.Math.Between(40, this.scale.height-40);
      const f = this.fuels.create(fx, fy, 'fuel');
      f.setImmovable(true);
    }
  }

  hitEnemy(player, enemy) {
    playerHealth -= 12;
    // knockback
    this.physics.velocityFromRotation(this.player.rotation + Math.PI, 200, this.player.body.velocity);
  }

  destroyEnemy(bullet, enemy) {
    if (bullet && bullet.destroy) bullet.destroy();
    if (!enemy) return;
    enemy.health -= 25;
    if (enemy.health <= 0) {
      // enemy killed
      if (enemy.destroy) enemy.destroy();
      score += 100;
      // mission progress
      if (currentMission && currentMission.type === 'kill') {
        currentMission.progress = (currentMission.progress || 0) + 1;
      }
      // spawn replacement
      this.spawnEnemies(1);
    }
  }

  collectFuel(player, fuel) {
    if (fuel && fuel.destroy) fuel.destroy();
    inventory.fuel = Math.min(100, inventory.fuel + 30);
    // spawn another fuel later
    this.time.delayedCall(6000, () => this.spawnFuels(1));
  }

  startMission() {
    currentMission = { type: 'kill', target: 3, progress: 0 };
    this.add.text(this.scale.width/2, 18, `Mission: Kill ${currentMission.target} Enemies`, { fontSize:'18px', color:'#fff' }).setOrigin(0.5).setDepth(20);
  }

  checkMissionComplete() {
    return currentMission && currentMission.progress >= currentMission.target;
  }

  completeMission() {
    score += 500;
    inventory.ammo += 6;
    this.add.text(this.scale.width/2, this.scale.height/2 - 40, 'Mission Complete!', { fontSize:'26px', color:'#88ff88' }).setOrigin(0.5).setDepth(30);
    currentMission = null;
    // start next mission after brief delay
    this.time.delayedCall(2500, () => this.startMission());
  }
}

class MissionScene extends Phaser.Scene {
  constructor() { super('MissionScene'); }
  create() {
    const w = this.scale.width, h = this.scale.height;
    this.add.text(w/2, h/2, 'Missions Coming Soon', { fontSize:'24px', color:'#fff' }).setOrigin(0.5);
  }
}

new Phaser.Game(config);
