import * as THREE from 'three';
import { cardImage } from './card-art.js';
import { trumpStyle, TRUMP_COLORS } from './trump-style.js';
import { CARD_BACK_IMAGE } from './trump-display.js';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
export class TableScene {
  constructor() {
    const qualityPreference = localStorage.getItem('wizard-low-graphics');
    this.low = qualityPreference === null ? matchMedia('(max-width: 600px)').matches : qualityPreference === 'true';
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2('#100e13', .033);
    this.camera = new THREE.PerspectiveCamera(43, 1, .1, 80);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !this.low;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.textures = new Map(); this.cards = new Map(); this.flames = [];
    this.mode = 'hero'; this.key = ''; this.frame = 0;
    this.trumpMotion = !reducedMotion;
    this.observer = new ResizeObserver(() => this.resize());
    this.scene.add(new THREE.HemisphereLight('#b6d6df', '#2f1c12', 2.0));
    const light = new THREE.DirectionalLight('#ffd4a1', 3.5);
    light.position.set(-4, 9, 4); light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    Object.assign(light.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: .5, far: 30 });
    light.shadow.normalBias = .025;
    this.scene.add(light);
    const rim = new THREE.DirectionalLight('#729dc4', 2); rim.position.set(5, 4, -6); this.scene.add(rim);
    this.buildTable();
    this.buildTrump();
    this.renderer.domElement.addEventListener('webglcontextlost', e => {
      e.preventDefault(); this.lost = true; this.host?.classList.remove('ready');
      document.body.classList.remove('has-webgl');
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.lost = false; this.host?.classList.add('ready'); document.body.classList.add('has-webgl');
    });
    this.animate(0);
  }
  material(color, options = {}) { return new THREE.MeshStandardMaterial({ color, roughness: .7, ...options }); }
  mesh(geometry, material, x, y, z, parent = this.scene) {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x,y,z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  buildTable() {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    const c = canvas.getContext('2d');
    c.fillStyle = '#503425'; c.fillRect(0,0,512,512);
    for (let i = 0; i < 900; i++) {
      const y = (i * 37.61) % 512;
      c.strokeStyle = `rgba(${i%2 ? '14,8,5' : '185,136,80'},${.05+(i%5)*.018})`;
      c.beginPath(); c.moveTo(0,y); c.bezierCurveTo(150,y+Math.sin(i)*7,350,y-Math.cos(i)*11,512,y+3); c.stroke();
    }
    for(let i=0;i<8;i++){c.fillStyle='#17110cb0';c.fillRect(0,i*64,512,2);}
    const woodMap = new THREE.CanvasTexture(canvas); woodMap.colorSpace = THREE.SRGBColorSpace;
    const wood = this.material('#a69c92',{ map: woodMap, roughness: .68 });
    const brass = this.material('#b99a5c',{ metalness: .7, roughness: .32 });
    this.surround = this.mesh(new THREE.PlaneGeometry(90,90),this.material('#49433e',{map:woodMap,roughness:.95}),0,-.42,0);
    this.surround.rotation.x = -Math.PI / 2;
    this.surround.visible = false;
    this.mesh(new THREE.BoxGeometry(13,.55,8.8),wood,0,-.12,0);
    this.mesh(new THREE.BoxGeometry(12.6,.08,8.4),brass,0,.19,0);
    this.mesh(new THREE.BoxGeometry(12.4,.12,8.2),wood,0,.26,0);
    this.mesh(new THREE.BoxGeometry(10.35,.025,6.5),this.material('#1b2927',{roughness:.97}),0,.335,0);
    const lineMat = new THREE.MeshBasicMaterial({color:'#ae8f51', transparent:true, opacity:.35, side:THREE.DoubleSide});
    this.trumpRingMaterial = lineMat;
    for (const radius of [2.25,2.38,2.8]) {
      const ring = this.mesh(new THREE.RingGeometry(radius,radius+.03,96),lineMat,0,.354,0);
      ring.rotation.x=-Math.PI/2;
    }
    for(let i=0;i<12;i++){
      const angle=i*Math.PI/6;
      const rune=this.mesh(new THREE.OctahedronGeometry(.07),brass,Math.cos(angle)*2.58,.36,Math.sin(angle)*2.58);
      rune.scale.y=.1;
    }
    this.candle(-5.25,-1.7,1.15, brass);
    this.candle(5.15,-1.8,.85,brass);
    this.candle(-4.8,-2.1,.7,brass);
    this.candle(4.8,-2.4,1.35,brass);
    const book = new THREE.Group(); book.position.set(-5,.5,1.55); book.rotation.y=.25; this.scene.add(book);
    this.mesh(new THREE.BoxGeometry(1.2,.18,1.7),this.material('#b3a080'),0,0,0,book);
    for (const y of [-.13,.13]) this.mesh(new THREE.BoxGeometry(1.3,.065,1.8),this.material('#402128'),0,y,0,book);
    this.mesh(new THREE.BoxGeometry(.15,.04,1.75),brass,.35,.18,0,book);
    this.mesh(new THREE.CylinderGeometry(.48,.6,.15,32),brass,4.8,.48,1.5);
    this.orb = this.mesh(new THREE.SphereGeometry(.43,28,20),this.material('#65aaac',{metalness:.4,roughness:.13,emissive:'#183b44',emissiveIntensity:1}),4.8,.96,1.5);
    const orbLight = new THREE.PointLight('#61d2cf',9,5); orbLight.position.set(4.8,1.3,1.5); this.scene.add(orbLight);
    for(let i=0;i<7;i++){
      const coin=this.mesh(new THREE.CylinderGeometry(.16,.16,.045,20),brass,3.85+(i%3)*.28,.4+Math.floor(i/3)*.05,2.6+(i%2)*.2);
      coin.rotation.z=(i%2)*.08;
    }
    // A physical deck with fine alternating layers, rather than a flat rectangle.
    this.deck = new THREE.Group(); this.scene.add(this.deck);
    for(let i=0;i<8;i++) this.mesh(new THREE.BoxGeometry(.85,.025,1.28),this.material(i%2?'#a6926a':'#253d40'),-3.7,.37+i*.028,1,this.deck);
    const back=this.mesh(new THREE.PlaneGeometry(.78,1.21),this.material('#31525b',{metalness:.2}),-3.7,.58,1,this.deck);
    back.rotation.x=-Math.PI/2;
    const positions = new Float32Array(80*3);
    for(let i=0;i<80;i++) { positions[i*3]=Math.sin(i*43)*7; positions[i*3+1]=.5+(i%19)/5; positions[i*3+2]=Math.cos(i*17)*5; }
    const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.BufferAttribute(positions,3));
    this.dust=new THREE.Points(geo,new THREE.PointsMaterial({color:'#e8c180',size:.025,transparent:true,opacity:.65,depthWrite:false}));
    this.scene.add(this.dust);
  }
  candle(x,z,height,brass) {
    this.mesh(new THREE.CylinderGeometry(.29,.39,.12,24),brass,x,.42,z);
    this.mesh(new THREE.CylinderGeometry(.09,.15,.5,18),brass,x,.7,z);
    this.mesh(new THREE.CylinderGeometry(.24,.15,.12,24),brass,x,.96,z);
    this.mesh(new THREE.CylinderGeometry(.13,.15,height,20),this.material('#d6bb87'),x,1+height/2,z);
    const flame=this.mesh(new THREE.SphereGeometry(.09,12,12),new THREE.MeshBasicMaterial({color:'#ffe7a5'}),x,1.1+height,z);
    flame.scale.set(.7,1.8,.7);
    const point=new THREE.PointLight('#ffb45b',14,7); point.position.copy(flame.position); this.scene.add(point);
    this.flames.push({flame,point,offset:x});
    const glowCanvas=document.createElement('canvas'); glowCanvas.width=64; glowCanvas.height=64;
    const ctx=glowCanvas.getContext('2d'), gradient=ctx.createRadialGradient(32,32,0,32,32,32);
    gradient.addColorStop(0,'rgba(255,191,85,.6)');gradient.addColorStop(.2,'rgba(255,141,45,.16)');gradient.addColorStop(1,'rgba(255,140,30,0)');
    ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);
    const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(glowCanvas),blending:THREE.AdditiveBlending,depthWrite:false}));
    glow.position.copy(flame.position);glow.scale.set(1.5,1.5,1);this.scene.add(glow);
  }
  face(card) {
    const key=cardImage(card);
    if(!this.textures.has(key)){
      const texture=new THREE.TextureLoader().load(key, loaded => {
        // The illustration's tiny printed corner cannot carry the game state on a phone.
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 480;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(loaded.image, 0, 0, 320, 480);
        ctx.fillStyle = '#0b1518'; ctx.fillRect(10, 10, 100, 128);
        ctx.fillStyle = '#fff0cb'; ctx.font = 'bold 70px Georgia, serif';
        ctx.fillText(card.kind === 'number' ? card.rank : card.kind === 'wizard' ? 'W' : 'J', 20, 81);
        ctx.fillStyle = TRUMP_COLORS[card.suit] || '#fff0cb'; ctx.font = '34px sans-serif';
        ctx.fillText({ blue: '❄', red: '♜', green: '❧', yellow: '✧', wizard: '✦', jester: '☾' }[card.suit || card.kind], 22, 122);
        loaded.image = canvas; loaded.needsUpdate = true;
      });
      texture.colorSpace=THREE.SRGBColorSpace;
      texture.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());
      this.textures.set(key,texture);
    }
    return this.textures.get(key);
  }
  buildTrump() {
    this.trump = new THREE.Group();
    this.trump.name = 'floating-trump';
    this.trumpCard = new THREE.Group();
    this.trump.add(this.trumpCard);
    const edge = this.material('#d7bf82', { metalness: .55, roughness: .35 });
    this.mesh(new THREE.BoxGeometry(1.12, 1.68, .055), edge, 0, 0, 0, this.trumpCard);
    this.trumpFace = this.mesh(new THREE.PlaneGeometry(1.1, 1.66), this.material('#ffffff', { roughness: .65, metalness: .08 }), 0, 0, .03, this.trumpCard);
    const backMap = new THREE.TextureLoader().load(CARD_BACK_IMAGE);
    backMap.colorSpace = THREE.SRGBColorSpace;
    const back = this.mesh(new THREE.PlaneGeometry(1.1, 1.66), this.material('#ffffff', { map: backMap, roughness: .65, metalness: .08 }), 0, 0, -.03, this.trumpCard);
    back.rotation.y = Math.PI;
    this.scene.add(this.trump);
  }
  updateTrump(state) {
    const card = this.mode === 'hero' ? { kind: 'wizard', id: 'sample-wizard' } : state.options?.deckMode === 'mono' ? null : state.reveal;
    this.trump.visible = Boolean(card);
    if (card) {
      const texture = this.face(card);
      if (this.trumpFace.material.map !== texture) {
        this.trumpFace.material.map = texture;
        this.trumpFace.material.needsUpdate = true;
      }
    }
  }
  attach(host, state) {
    if(!host) {this.host=null;this.observer.disconnect();return;}
    if(host!==this.host){
      this.observer.disconnect();this.host=host;host.append(this.renderer.domElement);this.observer.observe(host);
      if (!this.lost) { host.classList.add('ready');document.body.classList.add('has-webgl'); }
    }
    this.mode=state && !['lobby','rules'].includes(state.phase) ? 'game' : 'hero';
    this.lobby = ['lobby','rules'].includes(state?.phase);
    this.foresight = Boolean(state?.foresightActive);
    this.surround.visible = this.mode === 'game';
    this.trumpRingMaterial.color.set(this.mode === 'game' ? trumpStyle(state).color : '#ae8f51');
    this.trumpRingMaterial.opacity = this.mode === 'game' ? .85 : .35;
    this.updateTrump(state);
    const sample=[{kind:'number',suit:'blue',rank:13,id:'sample-blue'},{kind:'number',suit:'red',rank:7,id:'sample-red'}];
    const cards=this.mode==='hero' ? sample.map((card,player)=>({card,player})) : state.trick;
    const newKey=this.mode==='hero' ? 'hero' : `${state.round}-${state.completedTricks}-${cards.map(x=>x.card.id).join(',')}-${state.phase}`;
    if(newKey!==this.key){
      this.key=newKey;this.updateCards(cards,state);
    }
    this.resize();
  }
  updateCards(entries,state) {
    const keys=new Set(entries.map(x=>x.card.id));
    for(const [id,group] of this.cards) if(!keys.has(id)){
      this.scene.remove(group);
      group.traverse(obj=>{obj.geometry?.dispose();if(obj.material) obj.material.dispose();});
      this.cards.delete(id);
    }
    entries.forEach(({card,player},i)=>{
      let group=this.cards.get(card.id);
      if(!group){
        group=new THREE.Group();
        const edge=this.mesh(new THREE.BoxGeometry(1.12,.035,1.68),this.material('#d4bd87'),0,0,0,group);
        const face=this.mesh(new THREE.PlaneGeometry(1.1,1.66),this.material('#ffffff',{map:this.face(card),roughness:.65,metalness:.08}),0,.02,0,group);
        face.rotation.x=-Math.PI/2;
        group.position.set((i-entries.length/2)*1.1, reducedMotion? .43 : 2.8, 3.5);
        group.userData.face=face;group.userData.edge=edge;this.scene.add(group);this.cards.set(card.id,group);
      }
      const isWinner=state && ['trickEnd','roundEnd','finished'].includes(state.phase) && state.lastWinner===player;
      group.userData.edge.scale.set(isWinner ? 1.07 : 1,1,isWinner ? 1.05 : 1);
      group.userData.edge.material.color.set(isWinner ? '#ffe09a' : '#d4bd87');
      group.userData.edge.material.emissive.set(isWinner ? '#ffcf63' : '#000000');
      group.userData.edge.material.emissiveIntensity=isWinner ? .8 : 0;
      group.userData.target=new THREE.Vector3((i-(entries.length-1)/2)*(this.mode==='hero' ? 3.1 : 1.28),isWinner ? .56 : .43,this.mode==='hero' ? .65 : 1.4);
      group.userData.rotation=(i-(entries.length-1)/2)*(this.mode==='hero' ? -.14 : -.035);
      group.userData.face.material.emissive.set(isWinner?'#9e742f':'#000000');
      group.userData.face.material.emissiveIntensity=isWinner ? .25 : 0;
      if(reducedMotion){group.position.copy(group.userData.target);group.rotation.y=group.userData.rotation;}
    });
  }
  resize() {
    if(!this.host)return;
    const {width,height}=this.host.getBoundingClientRect();
    if(!width||!height)return;
    this.renderer.setSize(width,height,false);this.camera.aspect=width/height;
    this.camera.clearViewOffset();
    this.deck.position.x = this.mode === 'game' && width <= 600 ? -1.2 : 0;
    if (this.mode === 'game') {
      const mobile = width <= 600;
      const distance = THREE.MathUtils.clamp((mobile ? 9.6 : 11.8) / (2 * Math.tan(THREE.MathUtils.degToRad(43 / 2)) * this.camera.aspect), 9, 34);
      this.camera.position.set(0, distance * .68, distance * .73);
      // Spend the narrow viewport on readable cards, while fitting a six-card trick.
      const cardScale = mobile ? Math.min(1.7, 6.3 / this.cards.size) : 1;
      [...this.cards.values()].forEach((group, index) => {
        group.scale.set(cardScale, 1, cardScale);
        group.userData.target.x = (index - (this.cards.size - 1) / 2) * 1.28 * cardScale;
        if (reducedMotion) group.position.copy(group.userData.target);
      });
      this.trump.scale.setScalar(mobile ? 1.4 : height <= 520 ? .65 : .95);
      this.trump.position.set(0, mobile ? 1.7 : height <= 520 ? .95 : 1.25, 0);
      if (this.foresight) {
        this.trump.scale.multiplyScalar(.85);
        this.trump.position.set(0, mobile ? 1.4 : .95, mobile ? 1.1 : 1.25);
      }
    } else {
      this.camera.position.set(0,7.3,10.2);
      if (!this.lobby) this.camera.setViewOffset(width, height, -width * (width > 700 ? .18 : .28), 0, width, height);
      else if (width < 700) this.camera.position.multiplyScalar(1.4);
      this.trump.scale.setScalar(1.5);
      this.trump.position.set(0, 1.9, 0);
    }
    this.trump.userData.baseHeight = this.trump.position.y;
    this.camera.lookAt(0,0,0);this.camera.updateProjectionMatrix();
  }
  setLow(value) {
    this.low=value;localStorage.setItem('wizard-low-graphics',String(value));
    this.renderer.shadowMap.enabled=!value;
    // Refresh cached shaders too, or the previous shadow map remains visible.
    this.scene.traverse(object => {
      if (object.material) object.material.needsUpdate = true;
    });
    this.resize();
  }
  animate(time) {
    requestAnimationFrame(t=>this.animate(t));
    if(this.lost||document.hidden||!this.host?.isConnected)return;
    const interval=this.low?50:33;
    if(time-this.frame<interval)return;
    this.frame=time;
    const t=reducedMotion?0:time*.001;
    for(const {flame,point,offset} of this.flames){flame.scale.y=1.7+Math.sin(t*7+offset)*.18;point.intensity=14+Math.sin(t*5+offset)*1.4;}
    this.dust.visible=!this.low;
    this.dust.rotation.y=t*.014;
    this.orb.rotation.y=t*.2;
    if (this.trump.visible) {
      const trumpTime = this.trumpMotion ? time * .001 : 0;
      this.trump.position.y = this.trump.userData.baseHeight + Math.sin(trumpTime * Math.PI / 2.4) * (this.trumpMotion ? .07 : 0);
      this.trumpCard.rotation.y = -.25 + trumpTime * Math.PI / 8;
    }
    for(const group of this.cards.values()){
      group.position.lerp(group.userData.target,.19);
      group.rotation.y=THREE.MathUtils.lerp(group.rotation.y,group.userData.rotation,.15);
    }
    this.renderer.render(this.scene,this.camera);
  }
}
