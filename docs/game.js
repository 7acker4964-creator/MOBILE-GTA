// Demo game adapted for GitHub Pages (loads SVG assets from ./assets/images)
// Uses Phaser 3 and rex virtual joystick plugin (loaded from CDN in index.html)

const config = {
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  parent: 'game-container',
  backgroundColor: '#2b2b2b',
  physics: { default: 'arcade', arcade: { gravity: { y: 0 }, debug: false } },
  scene: [MenuScene, GameScene, MissionScene],
  plugins: {
    global: [{ key: 'rexVirtualJoystick', plugin: rexvirtualjoystickplugin, start: true }]
  }
};

let playerHealth = 100;
let score = 0;
let inventory = { ammo: 10, fuel: 100 };
let currentMission = null;

// Simple WebAudio-based sound manager to avoid binary audio files
class SoundManager {
  constructor() {
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
    this.engineOsc = null;
  }
  playGunshot() {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(1000, this.ctx.currentTime);
    g.gain.setValueAtTime(0.25, this.ctx.currentTime);
    o.connect(g); g.connect(this.ctx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.12);
    setTimeout(() => { try{ o.stop(); } catch(e){} }, 150);
  }
  startEngine() {
    if (!this.ctx || this.engineOsc) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(80, this.ctx.currentTime);
    g.gain.setValueAtTime(0.05, this.ctx.currentTime);
    o.connect(g); g.connect(this.ctx.destination);
    o.start();
    this.engineOsc = { o, g };
  }
  stopEngine() {
    if (!this.engineOsc) return;
    try { this.engineOsc.o.stop(); } catch(e){};
    this.engineOsc = null;
  }
}
const sound = new SoundManager();

class MenuScene extends Phaser.Scene {
  constructor(){ super('MenuScene'); }
  create(){
    const w = this.scale.width, h = this.scale.height;
    this.add.text(w/2, h*0.25, 'MOBILE-GTA Demo', { fontSize:'36px', color:'#fff' }).setOrigin(0.5);
    const s = this.add.text(w/2, h*0.55, 'Tap to Start', { fontSize:'24px', color:'#fff' }).setOrigin(0.5).setInteractive({useHandCursor:true});
    s.on('pointerdown', ()=>{ try{ sound.startEngine(); }catch(e){}; this.scene.start('GameScene'); });
    this.add.text(w/2, h*0.75, 'Joystick to move — Red button to shoot', { fontSize:'14px', color:'#ddd' }).setOrigin(0.5);
  }
}

class GameScene extends Phaser.Scene {
  constructor(){ super('GameScene'); }
  preload(){
    this.load.image('car', 'assets/images/car.svg');
    this.load.image('enemy', 'assets/images/enemy.svg');
    this.load.image('bullet', 'assets/images/bullet.svg');
    this.load.image('building', 'assets/images/building.svg');
    this.load.image('fuel', 'assets/images/fuel.svg');
  }
  create(){
    const w = this.scale.width, h = this.scale.height;
    // scatter buildings
    for (let i=0;i<25;i++){ const b = this.add.image(Phaser.Math.Between(0,w), Phaser.Math.Between(0,h), 'building'); b.setAlpha(0.55); b.setDepth(-1); }
    this.player = this.physics.add.sprite(w/2, h/2, 'car'); this.player.setCollideWorldBounds(true);
    this.enemies = this.physics.add.group(); this.fuels = this.physics.add.group(); this.bullets = this.physics.add.group();
    this.spawnEnemies(5); this.spawnFuels(3);
    this.joystick = null; if (this.plugins.has('rexVirtualJoystick')){ this.joystick = this.plugins.get('rexVirtualJoystick').add(this, { x:90, y:h-90, radius:60, base:this.add.circle(0,0,60,0x666666,0.35), thumb:this.add.circle(0,0,30,0xcccccc,0.35) }); }
    this.cursors = this.input.keyboard.createCursorKeys();
    this.shootButton = this.add.circle(w-80, h-80, 40, 0xff4444, 0.9).setInteractive({useHandCursor:true});
    this.shootButton.on('pointerdown', ()=> this.shoot()); this.shootButton.setScrollFactor(0);
    this.healthText = this.add.text(12,12,`Health: ${playerHealth}`,{fontSize:'18px',color:'#fff'}).setDepth(20);
    this.scoreText = this.add.text(12,36,`Score: ${score}`,{fontSize:'18px',color:'#fff'}).setDepth(20);
    this.inventoryText = this.add.text(12,60,`Ammo: ${inventory.ammo} Fuel: ${inventory.fuel}`,{fontSize:'16px',color:'#fff'}).setDepth(20);
    this.startMission();
    this.physics.add.collider(this.enemies,this.enemies); this.physics.add.collider(this.player,this.enemies,this.hitEnemy,null,this); this.physics.add.collider(this.bullets,this.enemies,this.destroyEnemy,null,this); this.physics.add.overlap(this.player,this.fuels,this.collectFuel,null,this);
    this._fuelAccumulator = 0; this._lowFuelText = null; this.lastRotation = 0;
  }
  update(time, delta){
    let vx=0, vy=0;
    if (this.joystick){ const force = this.joystick.force; vx = force.x * 220; vy = force.y * 220; if (force.x!==0 || force.y!==0){ this.lastRotation = Math.atan2(force.y, force.x); this.player.rotation = this.lastRotation; } }
    else { if (this.cursors.left.isDown) vx = -200; else if (this.cursors.right.isDown) vx = 200; if (this.cursors.up.isDown) vy = -200; else if (this.cursors.down.isDown) vy = 200; if (vx!==0 || vy!==0){ this.lastRotation = Math.atan2(vy, vx); this.player.rotation = this.lastRotation; } if (this.cursors.space && Phaser.Input.Keyboard.JustDown(this.cursors.space)) this.shoot(); }
    this.player.setVelocity(vx, vy);
    this.healthText.setText(`Health: ${playerHealth}`); this.scoreText.setText(`Score: ${score}`); this.inventoryText.setText(`Ammo: ${inventory.ammo} Fuel: ${Math.max(0, Math.floor(inventory.fuel))}`);
    if (currentMission && this.checkMissionComplete()) this.completeMission();
    const moving = Math.abs(vx)>1 || Math.abs(vy)>1; this._fuelAccumulator += delta; if (this._fuelAccumulator>=1000){ inventory.fuel = Math.max(0, inventory.fuel - (moving?1:0.2)); this._fuelAccumulator = 0; }
    if (inventory.fuel<=20 && !this._lowFuelText){ this._lowFuelText = this.add.text(this.scale.width/2,this.scale.height/2,'Low Fuel!',{fontSize:'28px',color:'#ff4444'}).setOrigin(0.5).setDepth(30); this.time.delayedCall(1500, ()=>{ if (this._lowFuelText){ this._lowFuelText.destroy(); this._lowFuelText = null; }}); }
    this.bullets.getChildren().forEach(b => { if (!this.cameras.main.worldView.contains(b.x,b.y)) b.destroy(); });
    this.enemies.getChildren().forEach(enemy=>{ if (!enemy.active) return; if (Phaser.Math.Between(0,1000)>995){ enemy.setVelocity(Phaser.Math.Between(-120,120),Phaser.Math.Between(-120,120)); } if (Phaser.Math.Between(0,1000)>995){ this.physics.moveToObject(enemy,this.player,90); } });
    if (playerHealth<=0){ score=0; inventory.ammo=10; inventory.fuel=100; playerHealth=100; sound.stopEngine(); this.scene.start('MenuScene'); }
  }
  shoot(){ if (inventory.ammo<=0) return; inventory.ammo--; const bullet = this.physics.add.sprite(this.player.x,this.player.y,'bullet'); bullet.setDepth(15); bullet.body.setAllowGravity(false); bullet.body.setCollideWorldBounds(true); bullet.body.onWorldBounds = true; const speed = 420; bullet.setVelocity(Math.cos(this.player.rotation)*speed, Math.sin(this.player.rotation)*speed); bullet.rotation = this.player.rotation; this.time.delayedCall(2000, ()=>{ if (bullet && bullet.destroy) bullet.destroy(); }); try{ sound.playGunshot(); }catch(e){} this.bullets.add(bullet); }
  spawnEnemies(count){ for (let i=0;i<count;i++){ const ex = Phaser.Math.Between(50,this.scale.width-50); const ey = Phaser.Math.Between(50,this.scale.height-50); const enemy = this.enemies.create(ex,ey,'enemy'); enemy.setCollideWorldBounds(true); enemy.setBounce(1); enemy.setVelocity(Phaser.Math.Between(-100,100),Phaser.Math.Between(-100,100)); enemy.health = 50; } }
  spawnFuels(count){ for (let i=0;i<count;i++){ const fx = Phaser.Math.Between(40,this.scale.width-40); const fy = Phaser.Math.Between(40,this.scale.height-40); const f = this.fuels.create(fx,fy,'fuel'); f.setImmovable(true); } }
  hitEnemy(player, enemy){ playerHealth -= 12; this.physics.velocityFromRotation(this.player.rotation + Math.PI, 200, this.player.body.velocity); }
  destroyEnemy(bullet, enemy){ if (bullet && bullet.destroy) bullet.destroy(); if (!enemy) return; enemy.health -= 25; if (enemy.health <= 0){ if (enemy.destroy) enemy.destroy(); score += 100; if (currentMission && currentMission.type === 'kill'){ currentMission.progress = (currentMission.progress || 0) + 1; } this.spawnEnemies(1); } }
  collectFuel(player, fuel){ if (fuel && fuel.destroy) fuel.destroy(); inventory.fuel = Math.min(100, inventory.fuel + 30); this.time.delayedCall(6000, ()=> this.spawnFuels(1)); }
  startMission(){ currentMission = { type:'kill', target:3, progress:0 }; this.add.text(this.scale.width/2,18,`Mission: Kill ${currentMission.target} Enemies`,{fontSize:'18px',color:'#fff'}).setOrigin(0.5).setDepth(20); }
  checkMissionComplete(){ return currentMission && currentMission.progress >= currentMission.target; }
  completeMission(){ score += 500; inventory.ammo += 6; this.add.text(this.scale.width/2,this.scale.height/2 - 40,'Mission Complete!',{fontSize:'26px',color:'#88ff88'}).setOrigin(0.5).setDepth(30); currentMission = null; this.time.delayedCall(2500, ()=> this.startMission()); }
}

class MissionScene extends Phaser.Scene { constructor(){ super('MissionScene'); } create(){ const w=this.scale.width,h=this.scale.height; this.add.text(w/2,h/2,'Missions Coming Soon',{fontSize:'24px',color:'#fff'}).setOrigin(0.5); } }

new Phaser.Game(config);
