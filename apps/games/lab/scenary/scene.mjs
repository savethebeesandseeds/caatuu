import { buildNavigation, planRoute, advanceRoute, project, unproject } from './navigation.mjs';
import { WALKING_MOTION_BASE, parseWalkingMotion, walkingMotionURL, walkingMotionPose } from '/games/lab/assets/walking-motion.mjs';
import {walkingMetrics, advanceWalkingCycles} from '/games/lab/assets/locomotion.mjs';

const canvas = document.querySelector('#scene');
const context = canvas.getContext('2d');
const status = document.querySelector('#movement-state');
const message = document.querySelector('#scene-message');
const loading = document.querySelector('#loading');
const view = document.querySelector('#view');
const returnButton = document.querySelector('#return');
const actorSize = document.querySelector('#actor-size');
const help = document.querySelector('#scene-help');
const SCENERY = '/assets/scenery/';
const C = Math.SQRT1_2;
const COS30 = Math.sqrt(3) / 2;
const names = {N:'North',NE:'Northeast',E:'East',SE:'Southeast',S:'South',SW:'Southwest',W:'West',NW:'Northwest'};
const textureCache = new Map();
let world, catalog, navigation, actor, spawn, terrain;
let props = [], frames = new Map();
let viewport = {width:1200,height:720,dpr:1};
let bounds, camera, destination = null, lastTime = 0, animationTime = 0;
let ready = false, wasMoving = false, pointerStart = null;
let motion, actorScale = 1, walkingCycles = 0, travelledDistance = 0;

function selectSize() {
  actorScale = Number(actorSize.value);
  walkingMetrics(motion.profile, actorScale);
  updateStatus();draw();
}

async function json(url) {
  const response = await fetch(url, {cache:'no-store'});
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status}).`);
  return response.json();
}

function image(url) {
  if (textureCache.has(url)) return textureCache.get(url);
  const pending = new Promise((resolve,reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load image: ${url}`));
    img.src = url;
  });
  textureCache.set(url,pending);
  return pending;
}

function sceneryURL(file) {
  if (!/^images\/[a-z0-9-]+\.png$/.test(file)) throw new Error('Scenery must use the reviewed runtime images.');
  return SCENERY + file;
}

function sceneBounds() {
  const extents = [];
  const halfWidth = world.terrain.columns * world.terrain.cell_size / 2;
  const halfDepth = world.terrain.rows * world.terrain.cell_size / 2;
  for (const x of [-halfWidth,halfWidth]) for (const z of [-halfDepth,halfDepth]) extents.push(project({x,z}));
  for (const prop of props) {
    const p = project(prop.position), k = prop.worldHeight * COS30 / prop.height;
    extents.push({x:p.x-prop.anchorX*k,y:p.y-prop.anchorY*k-.02*COS30});
    extents.push({x:p.x+(prop.width-prop.anchorX)*k,y:p.y+(prop.height-prop.anchorY)*k});
  }
  return {left:Math.min(...extents.map(p=>p.x))-.55,right:Math.max(...extents.map(p=>p.x))+.55,
    top:Math.min(...extents.map(p=>p.y))-.5,bottom:Math.max(...extents.map(p=>p.y))+.5};
}

function updateCamera() {
  const fit = Math.min(viewport.width/(bounds.right-bounds.left), viewport.height/(bounds.bottom-bounds.top));
  const close = view.value==='close';
  const focus = close ? project(actor.position) : {x:(bounds.left+bounds.right)/2,y:(bounds.top+bounds.bottom)/2};
  const unit = close ? Math.max(fit*1.7,60) : fit;
  camera = {unit,x:viewport.width/2-focus.x*unit,y:viewport.height*(close ? .59 : .5)-focus.y*unit};
}

function toScreen(point) {
  const p = project(point);
  return {x:camera.x+p.x*camera.unit,y:camera.y+p.y*camera.unit};
}

function makeTerrain(atlas) {
  const grid = world.terrain.tile_index_rows;
  const tile = world.terrain.render_tiles;
  const padding = 3, unit = 88;
  const columns = grid[0].length, rows = grid.length;
  const half = (columns+rows)/2 + padding*2;
  const sheet = document.createElement('canvas');
  sheet.width = Math.ceil(half*Math.SQRT2*unit)+4;
  sheet.height = Math.ceil(half*C*unit)+4;
  const ctx = sheet.getContext('2d');
  const origin = {x:sheet.width/2,y:sheet.height/2};
  const size = tile.tile_content_size_px[0];
  ctx.imageSmoothingEnabled = true;
  for (let row=-padding;row<rows+padding;row++) for (let col=-padding;col<columns+padding;col++) {
    let index = grid[row]?.[col] ?? tile.padding_tile_index;
    if (index===43) index=[43,44,45,46,47][((col*7+row*11+col*row*3)%5+5)%5];
    const p = project({x:col-columns/2,z:row-rows/2});
    const stride=tile.tile_size_px[0], gutter=tile.tile_gutter_px;
    ctx.setTransform(unit*C/size,unit*C*.5/size,-unit*C/size,unit*C*.5/size,origin.x+p.x*unit,origin.y+p.y*unit);
    ctx.drawImage(atlas,(index%tile.atlas_grid[0])*stride+gutter,Math.floor(index/tile.atlas_grid[0])*stride+gutter,size,size,0,0,size+.4,size+.4);
  }
  return {image:sheet,origin,unit};
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  viewport = {width:rect.width,height:rect.height,dpr:Math.min(window.devicePixelRatio||1,2)};
  canvas.width = Math.round(viewport.width*viewport.dpr);
  canvas.height = Math.round(viewport.height*viewport.dpr);
  if (ready) { updateCamera(); draw(); }
}

function drawPath() {
  if (!actor.waypoints.length || !destination) return;
  context.save();
  context.strokeStyle = '#e7ddac88'; context.lineWidth = 1.5; context.setLineDash([3,7]);
  context.beginPath();
  const origin=toScreen(actor.position); context.moveTo(origin.x,origin.y);
  for (const point of actor.waypoints) { const p=toScreen(point); context.lineTo(p.x,p.y); }
  context.stroke(); context.setLineDash([]);
  const p = toScreen(destination), pulse=1+Math.sin(animationTime*4)*.08;
  context.fillStyle='#71ede438'; context.strokeStyle='#a4fff0'; context.lineWidth=2;
  context.beginPath();context.ellipse(p.x,p.y,camera.unit*.18*pulse,camera.unit*.09*pulse,0,0,Math.PI*2);context.fill();context.stroke();
  context.restore();
}

function drawMacaw() {
  const pose = walkingMotionPose(motion, actor.direction, actor.action, walkingCycles);
  const mapping = pose.mapping, phase = pose.slot, id = pose.frame.id, frame = frames.get(id);
  const metrics = walkingMetrics(motion.profile, actorScale);
  const p=toScreen(actor.position);
  const size = camera.unit*metrics.canvasWorldSize, k=size/512;
  context.save();
  context.fillStyle='#15281755';context.beginPath();context.ellipse(p.x,p.y,camera.unit*.25*actorScale,camera.unit*.12*actorScale,0,0,Math.PI*2);context.fill();
  context.translate(p.x,p.y);
  if (mapping.mirror) context.scale(-1,1);
  context.imageSmoothingEnabled=false;
  context.drawImage(frame.image,-256*k,-480*k,size,size);
  context.restore();
  canvas.dataset.frame=id;
  canvas.dataset.pose=String(phase);
  canvas.dataset.mirror=String(mapping.mirror);
  canvas.dataset.motionSet='walking';
  canvas.dataset.actorScale=String(actorScale);
  canvas.dataset.walkingSpeed=metrics.speed.toFixed(6);
  canvas.dataset.cycleDistance=metrics.cycleDistance.toFixed(6);
  canvas.dataset.walkingCycles=walkingCycles.toFixed(6);
  canvas.dataset.travelledDistance=travelledDistance.toFixed(6);
  canvas.dataset.action=actor.action;
  canvas.dataset.direction=actor.direction;
  canvas.dataset.x=actor.position.x.toFixed(4);
  canvas.dataset.z=actor.position.z.toFixed(4);
}

function drawProp(prop) {
  const p=toScreen(prop.position), k=camera.unit*prop.worldHeight*COS30/prop.height;
  const anchorY=p.y-.02*COS30*camera.unit;
  const left=p.x-prop.anchorX*k, top=anchorY-prop.anchorY*k;
  const macaw=toScreen(actor.position);
  const inFront = prop.position.x+prop.position.z > actor.position.x+actor.position.z+.1;
  const covers = macaw.x>left && macaw.x<left+prop.width*k && macaw.y-camera.unit*.7>top && macaw.y-camera.unit*.7<top+prop.height*k;
  context.save();
  if (inFront && covers) context.globalAlpha=.42;
  context.translate(p.x,anchorY);
  if (prop.flip) context.scale(-1,1);
  context.imageSmoothingEnabled=true;
  context.drawImage(prop.image,-prop.originalAnchorX*k,-prop.anchorY*k,prop.width*k,prop.height*k);
  context.restore();
}

function draw() {
  context.setTransform(viewport.dpr,0,0,viewport.dpr,0,0);
  context.fillStyle='#718044'; context.fillRect(0,0,viewport.width,viewport.height);
  const scale = camera.unit/terrain.unit;
  context.imageSmoothingEnabled=true;
  context.drawImage(terrain.image,camera.x-terrain.origin.x*scale,camera.y-terrain.origin.y*scale,terrain.image.width*scale,terrain.image.height*scale);
  drawPath();
  const layers = props.map(prop=>({depth:prop.position.x+prop.position.z,prop}));
  layers.push({depth:actor.position.x+actor.position.z,actor:true});
  layers.sort((a,b)=>a.depth-b.depth);
  for (const layer of layers) layer.actor ? drawMacaw() : drawProp(layer.prop);
  const fade=context.createRadialGradient(viewport.width/2,viewport.height/2,viewport.width*.2,viewport.width/2,viewport.height/2,Math.max(viewport.width,viewport.height)*.72);
  fade.addColorStop(0,'#10211700');fade.addColorStop(1,'#10211766');
  context.fillStyle=fade;context.fillRect(0,0,viewport.width,viewport.height);
}

function moveTo(point) {
  const route=planRoute(navigation,actor.position,point);
  actor.position={...route.start};
  actor.waypoints=route.waypoints;
  actor.action=route.action==='idle'?'idle':'walk';
  actor.distanceRemaining=route.length;
  destination=route.target;
  animationTime=0;
  walkingCycles=0;travelledDistance=0;
  wasMoving=actor.action!=='idle';
  canvas.dataset.trip=actor.action;
  canvas.dataset.targetX=route.target.x.toFixed(4);
  canvas.dataset.targetZ=route.target.z.toFixed(4);
  canvas.dataset.adjusted=String(route.adjusted);
  if (actor.action==='idle') message.textContent='We are already here. Pick another spot.';
  else message.textContent=route.adjusted ? 'Heading to the nearest clear spot.' : 'Just a little walk.';
  updateStatus();
}

function updateStatus() {
  const label=actor.action==='idle'?'Standing':actor.action==='run'?'Running':'Walking';
  const text=`${label} · ${names[actor.direction]}`;
  if (status.textContent!==text) status.textContent=text;
}

function tick(time) {
  if (ready && !document.hidden) {
    const dt=lastTime?Math.min((time-lastTime)/1000,.05):0;
    if (actor.action!=='idle') animationTime+=dt;
    const metrics = walkingMetrics(motion.profile, actorScale);
    const before = actor.distanceRemaining;
    advanceRoute(actor,dt,metrics.speed);
    const travelled = Math.max(0,before-actor.distanceRemaining);
    travelledDistance += travelled;
    walkingCycles = advanceWalkingCycles(walkingCycles,travelled,metrics);
    if (wasMoving && actor.action==='idle') { message.textContent='Here we are. Pick the next spot.'; destination=null; wasMoving=false; }
    updateCamera();updateStatus();draw();
  }
  lastTime=time;
  requestAnimationFrame(tick);
}

canvas.addEventListener('pointerdown',event=>{ if(event.isPrimary && event.button===0) pointerStart={x:event.clientX,y:event.clientY}; });
canvas.addEventListener('pointercancel',()=>{pointerStart=null;});
canvas.addEventListener('pointerup',event=>{
  const start=pointerStart;pointerStart=null;
  if (!ready || !start || !event.isPrimary || Math.hypot(event.clientX-start.x,event.clientY-start.y)>12) return;
  const rect=canvas.getBoundingClientRect();
  moveTo(unproject({x:(event.clientX-rect.left-camera.x)/camera.unit,y:(event.clientY-rect.top-camera.y)/camera.unit}));
});
returnButton.addEventListener('click',()=>{if(ready)moveTo(spawn);});
view.addEventListener('change',()=>{if(ready){updateCamera();draw();}});
actorSize.addEventListener('change',()=>{if(ready)selectSize();});
document.addEventListener('visibilitychange',()=>{lastTime=0;});
new ResizeObserver(resize).observe(canvas);

async function start() {
  motion = parseWalkingMotion(await json(`${WALKING_MOTION_BASE}manifest.json`));
  [world,catalog] = await Promise.all([json(`${SCENERY}metadata/world.json`),json(`${SCENERY}metadata/catalog.json`)]);
  navigation=buildNavigation(world,catalog);
  spawn=navigation.nearestWalkable(world.spawn_points[0].position);
  actor={position:{...spawn},waypoints:[],action:'idle',direction:'NE',distanceRemaining:0};
  loading.textContent='Inviting the macaw…';
  const [atlas,loadedFrames,loadedProps]=await Promise.all([
    image(sceneryURL(world.terrain.render_tiles.texture)),
    Promise.all([...motion.frames.values()].map(async frame=>({...frame,image:await image(walkingMotionURL(frame))}))),
    Promise.all(world.placements.map(async placement=>{
      const definition=catalog.objects[placement.object];
      const [width,height]=definition.image_size_px;
      return {position:{x:placement.position[0],z:placement.position[1]},image:await image(sceneryURL(definition.texture)),
        width,height,originalAnchorX:definition.anchor_px[0],anchorX:placement.flip_horizontal?width-definition.anchor_px[0]:definition.anchor_px[0],
        anchorY:definition.anchor_px[1],worldHeight:definition.default_world_height*placement.scale,flip:placement.flip_horizontal};
    }))
  ]);
  frames=new Map(loadedFrames.map(frame=>[frame.id,frame]));
  props=loadedProps;terrain=makeTerrain(atlas);bounds=sceneBounds();ready=true;
  canvas.dataset.ready='true';canvas.dataset.loadedFrames=String(frames.size);
  loading.hidden=true;returnButton.disabled=false;actorSize.disabled=false;
  help.textContent='Click or tap the ground to walk. Pick another spot to change course.';
  message.textContent='Choose a spot in the grove to begin.';
  resize();selectSize();
  requestAnimationFrame(tick);
}

start().catch(error=>{
  console.error(error);loading.textContent=`The grove could not load. ${error.message} Refresh to try again.`;
  loading.classList.add('failed');status.textContent='Unable to load';
});
