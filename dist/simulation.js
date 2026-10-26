/* Teaching model. Replace these estimates with measured FB45 response data. */
(()=>{'use strict';
const by=id=>document.getElementById(id),canvas=by('brewerCanvas'),ctx=canvas.getContext('2d');
const MODEL={maxFlow:10,baseEY:18,tempEffect:.23,turbulenceEffect:.7,pulseEffect:.45,pauseEffect:.035,waterEffect:.006,retention:2,drainMild:90,drainBold:120};
const recipes={mild:{dose:15,water:250,temp:94,turb:0,pulses:1,pause:0,bloom:25,rate:8,height:4},medium:{dose:14,water:250,temp:95,turb:1,pulses:3,pause:7,bloom:28,rate:9,height:6},bold:{dose:13,water:250,temp:96,turb:2,pulses:5,pause:10,bloom:30,rate:10,height:8}};
const defaultRecipes=JSON.parse(JSON.stringify(recipes)),presetKey='kode-brewing-recipes-v1';let savedPresets={};
try{const stored=JSON.parse(localStorage.getItem(presetKey)||'{}');for(const name of ['mild','medium','bold']){const p=stored[name];if(p&&typeof p==='object'&&['dose','water','temp','rate','height','pulses','pause'].every(k=>Number.isFinite(p[k]))&&p.dose>=11&&p.dose<=25&&p.water>=180&&p.water<=400&&p.temp>=90&&p.temp<=100&&p.rate>=2&&p.rate<=10&&p.height>=2&&p.height<=12&&Number.isInteger(p.pulses)&&p.pulses>=1&&p.pulses<=8&&p.pause>=0&&p.pause<=20){savedPresets[name]={...defaultRecipes[name],...Object.fromEntries(['dose','water','temp','rate','height','pulses','pause'].map(k=>[k,p[k]]))};recipes[name]={...savedPresets[name]}}}}catch{}
const definitions=[['dose','Coffee dose',11,25,.5,'g'],['water','Brewing water',180,400,10,'g'],['temp','Water temperature',90,100,1,'°C'],['rate','Agitating pour rate',2,10,.5,'g/s'],['height','Pour height above slurry',2,12,1,'cm'],['pulses','Agitating pulses',1,8,1,''],['pause','Pause between pulses',0,20,1,'s']];
by('simFields').innerHTML=definitions.map(([id,label,min,max,step])=>`<div class="field"><label for="brew_${id}">${label}<b id="brew_${id}Val"></b></label><input id="brew_${id}" type="range" min="${min}" max="${max}" step="${step}"></div>`).join('');
let bedCells=[],suspended=0,showFullServer=false,actualBrew=null;
let recipe='mild',settings={...recipes.mild},segments=[],duration=150,time=0,running=false,last=0,frameId=0,waterPool=0,energy=0,particles=[],traces=[],poured=0,drained=0,hasStarted=false;
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
function rand(i){return (Math.sin(i*127.1+311.7)*43758.5453)%1+1- Math.floor((Math.sin(i*127.1+311.7)*43758.5453)%1+1)}
function configure(){actualBrew=null;by('actualError').textContent='';settings=Object.fromEntries(definitions.map(([id])=>[id,+by('brew_'+id).value]));by('actualDose').value=settings.dose;settings.bloom=recipes[recipe].bloom;settings.turb=recipes[recipe].turb;definitions.forEach(([id,,,,,unit])=>by('brew_'+id+'Val').textContent=id==='turb'?['Gentle','Moderate','High'][settings[id]]:settings[id]+(unit?' '+unit:''));makeSchedule();restart();}
function makeSchedule(){segments=[];let t=0;function add(label,sec,mass,type){segments.push({label,start:t,end:t+sec,mass,type});t+=sec}
const bloom=Math.max(50,3*settings.dose),rest=settings.water-bloom,passive=recipe==='mild'?rest*.5:recipe==='bold'?rest*.25:rest*.35;
add('Bloom',bloom/Math.min(5,settings.rate),bloom,'bloom');add('Bloom rest',settings.bloom,0,'pause');
for(let i=0;i<settings.pulses;i++){const m=(rest-passive)/settings.pulses;add(`Agitating pulse ${i+1} of ${settings.pulses}`,m/settings.rate,m,'pour');if(i<settings.pulses-1&&settings.pause)add('Between pulses',settings.pause,0,'pause')}
if(recipe==='bold'&&settings.pause)add('Before final pour',settings.pause,0,'pause');add('Gentle final pour',passive/Math.min(settings.rate,recipe==='mild'?4:5),passive,'passive');add('Drawdown',recipe==='mild'?MODEL.drainMild:MODEL.drainBold,0,'draw');duration=t;
by('simTimeline').innerHTML=segments.map(s=>`<span class="${s.type}" style="flex:${s.end-s.start}" title="${s.label}: ${Math.round(s.end-s.start)} seconds"></span>`).join('');}
function finalEY(){return Math.max(14,Math.min(26,MODEL.baseEY+(settings.rate-recipes[recipe].rate)*.08+(settings.temp-94)*MODEL.tempEffect+settings.turb*MODEL.turbulenceEffect+(settings.pulses-1)*MODEL.pulseEffect+settings.pause*MODEL.pauseEffect+(settings.water-250)*MODEL.waterEffect))}
function resetParticles(){particles=Array.from({length:Math.round(settings.dose*15)},(_,i)=>({x:310+rand(i+1)*230,y:426-rand(i+700)*bedDepth(),vx:0,vy:0,r:1+rand(i+400)*1.7}));traces=Array.from({length:90},(_,i)=>({x:280+rand(i+1400)*290,y:350+rand(i+1700)*100,life:rand(i+2000)}))}
function bedDepth(){return 30+settings.dose*2.1}
// Bed cross-section: material is eroded locally, held in suspension and redeposited.
// Cell material is conserved. This is a reduced teaching model, not CFD/DEM.
const BED_LEFT=300,BED_RIGHT=550,CELLS=51;
function bedSurface(x){const index=Math.max(0,Math.min(CELLS-1,(x-BED_LEFT)/(BED_RIGHT-BED_LEFT)*(CELLS-1))),i=Math.floor(index),j=Math.min(CELLS-1,i+1);return 426-((bedCells[i]||bedDepth())*(1-index+i)+(bedCells[j]||bedDepth())*(index-i))}
function impact(){const f=flow(),waterDepth=waterPool*.9;
// Estimate nozzle velocity for a 4 mm jet, then gravity acceleration and spreading.
const velocity=Math.sqrt((f/12.57)**2+2*9.81*settings.height/100);
const breakup=1/(1+Math.pow(settings.height/(8+settings.rate*.9),4));
const reach=Math.exp(-waterDepth/(35+velocity*22));
return {power:f/10*velocity*breakup*reach,width:12+waterDepth*.15,waterDepth,breakup}}
function updateBed(dt){const hit=impact(),x=spoutX();let lifted=0;
for(let i=0;i<CELLS;i++){const cx=BED_LEFT+i*5,weight=Math.exp(-(((cx-x)/hit.width)**2)),amount=Math.min(bedCells[i]*.2,hit.power*weight*dt*2.5);bedCells[i]-=amount;lifted+=amount} suspended+=lifted;
// Settling redistributes lifted material around the impact region; no target crater.
const settle=Math.min(suspended,suspended*dt*(.35/(1+energy))),weights=bedCells.map((_,i)=>{const dx=BED_LEFT+i*5-x;return .06+Math.exp(-(((Math.abs(dx)-30)/22)**2))}),total=weights.reduce((a,b)=>a+b,0);
weights.forEach((w,i)=>bedCells[i]+=settle*w/total);suspended-=settle;
// Local avalanches relax over-steep slopes while conserving cell material.
for(let pass=0;pass<2;pass++)for(let i=0;i<CELLS-1;i++){const diff=bedCells[i]-bedCells[i+1],excess=Math.max(0,Math.abs(diff)-3.3),move=Math.min(excess*.5,excess*dt*3);if(diff>0){bedCells[i]-=move;bedCells[i+1]+=move}else{bedCells[i]+=move;bedCells[i+1]-=move}}
}
function restart(){running=false;time=0;waterPool=0;energy=0;poured=0;drained=0;hasStarted=false;bedCells=Array(CELLS).fill(bedDepth());suspended=0;by('simPlay').textContent='▶ Brew recipe';resetParticles();updateUI();draw();}
function activeSegment(){return segments.find(s=>time>=s.start&&time<s.end)||segments[segments.length-1]}
function flow(){const s=activeSegment();return time<duration&&s.mass?s.mass/(s.end-s.start):0}
function estimateProgress(){const target=finalEY();return hasStarted?target*(1-Math.exp(-4.1*time/duration))/(1-Math.exp(-4.1)):0}
function updateUI(){let s=activeSegment(),ey=estimateProgress(),beverage=Math.max(1,settings.water-MODEL.retention*settings.dose),tds=finalEY()*settings.dose/beverage;by('simPhase').textContent=time>=duration?'Brew complete':hasStarted?s.label:'Ready to bloom';by('simClock').textContent=`${Math.floor(time/60)}:${String(Math.floor(time%60)).padStart(2,'0')} / ${Math.floor(duration/60)}:${String(Math.round(duration%60)).padStart(2,'0')}`;by('simPoured').textContent=`${Math.round(poured)} / ${settings.water} g poured · ${(hasStarted?flow():0).toFixed(1)} g/s`;by('simProgress').style.width=time/duration*100+'%';by('simScrub').value=time/duration*1000;const style=finalEY()<19?'Mild':finalEY()<22?'Medium':'Bold';by('simOutcome').textContent=`Estimated finish: ${style.toLowerCase()} extraction · ${tds<1.2?'light':tds<1.5?'rounded':'strong'} strength`;by('simExplanation').textContent=hasStarted&&flow()>0?'The incoming stream drives local mixing. Impact depends on pour rate, height and the water above the bed. Local erosion lifts material; surrounding slopes can slump back.':hasStarted&&time<duration?'The stream has stopped. Swirling decays, particles settle, and water continues draining through the bed.':'Compare recipes, or change a single variable and replay. Longer pauses let the water level fall before the next pulse hits.';by('simAdvanced').textContent=`Model finish: ${finalEY().toFixed(1)}% EY · ${tds.toFixed(2)}% TDS · ≈${beverage.toFixed(0)} g beverage. EY is a separate recipe estimate, not predicted by the bed model. Current illustrative extraction progress: ${ey.toFixed(1)}%.`;
// One recipe state supplies both brewer and chart. This is a comparison animation,
// not an estimate of instantaneous beverage concentration during extraction.
window.currentBrewDose=settings.dose;
const baseEY=18,baseTDS=18*15/220,targetEY=actualBrew?actualBrew.ey:finalEY(),targetTDS=actualBrew?actualBrew.tds:tds;
const fraction=1;
const coord=(e,t)=>({x:85+(e-14)/12*635,y:400-(t-.6)/1.2*355});
const origin=coord(baseEY,baseTDS),target=coord(targetEY,targetTDS),current=coord(baseEY+(targetEY-baseEY)*fraction,baseTDS+(targetTDS-baseTDS)*fraction);
for(const [id,p] of [['origin',origin],['point',current],['targetPoint',target]]){by(id).setAttribute('cx',p.x);by(id).setAttribute('cy',p.y)}
document.querySelector('.ratioKey').style.setProperty('display',actualBrew?'none':'',actualBrew?'important':'');by('ratioLine').style.display=actualBrew?'none':'';by('ratioLineLabel').style.display=actualBrew?'none':'';by('trail').style.display='none';by('origin').style.display='none';
for(const [key,value] of Object.entries({x1:origin.x,y1:origin.y,x2:target.x,y2:target.y}))by('trail').setAttribute(key,value);
const chartDose=actualBrew?actualBrew.dose:settings.dose,chartMass=actualBrew?actualBrew.mass:beverage;const low=coord(14,14*chartDose/chartMass),high=coord(26,26*chartDose/chartMass);by('ratioLine').setAttribute('d',`M${low.x} ${low.y}L${high.x} ${high.y}`);
const flavour={mild:'Fruit-forward, with a lighter body and a gently developed flavour.',medium:'Balanced and rounded, with a medium body and developed sweetness.',bold:'Fuller-bodied and more intense, with a deeply developed flavour.'}[recipe];
by('mapCaption').innerHTML=`<span class="simple">${actualBrew?'Measured brew plotted. Taste to assess flavour.':'Expected flavour: '+flavour}</span><span class="advanced">${actualBrew?'Measured TDS':'Estimated TDS'}: ${targetTDS.toFixed(2)}% · ${actualBrew?'Calculated extraction yield':'Extraction yield'}: ${targetEY.toFixed(1)}%</span>`;
by('chartComparison').textContent='The point shows the current recipe. Its position combines extraction yield and beverage strength.';
by('ratioLineLabel').textContent=actualBrew?'Measured brew':`1:${(settings.water/settings.dose).toFixed(1)}`;by('ratioLineLabel').setAttribute('y',Math.max(125,coord(25,25*chartDose/chartMass).y-14));
by('ratioLabel').textContent=`Brew ratio · ${settings.dose} g coffee : ${settings.water} g water (1 : ${(settings.water/settings.dose).toFixed(1)})`;by('ratioExplanation').textContent='The dotted line keeps this coffee-to-water ratio fixed. Moving right along it means extracting more coffee, which also makes the beverage stronger. Changing the dose or water moves the line.';
by('chartNumbers').textContent=actualBrew?`Measured brew: ${actualBrew.dose} g dry coffee · ${actualBrew.mass} g beverage · ${actualBrew.tds.toFixed(2)}% measured TDS · ${actualBrew.ey.toFixed(2)}% calculated extraction yield.`:`${actualBrew?'Recipe estimate (separate from measured point)':'Current recipe'}: ${settings.dose} g coffee / ${settings.water} g water · ${targetEY.toFixed(1)}% estimated EY · ${targetTDS.toFixed(2)}% estimated TDS · ≈${beverage.toFixed(0)} g beverage. Qualitative extraction labels have no validated numerical boundaries.`;
by('zoomReading').textContent=`${actualBrew?'Measured TDS':'Estimated TDS'} ${targetTDS.toFixed(2)}% · ${actualBrew?'Calculated EY':'EY'} ${targetEY.toFixed(1)}%`;by('targetPoint').dataset.ey=targetEY.toFixed(1);by('targetPoint').dataset.tds=targetTDS.toFixed(2);window.refreshMeasuringRulers?.();
const waitingForActual=document.body.classList.contains('actualMode')&&!actualBrew;by('point').style.visibility=waitingForActual?'hidden':'';by('targetPoint').style.visibility=waitingForActual?'hidden':'';if(waitingForActual){by('zoomReading').textContent='Enter your measurements to see your reading.';by('mapCaption').textContent='Enter your measurements below to plot the actual brew.';by('chartNumbers').textContent='';by('ratioLine').style.display='none';by('ratioLineLabel').style.display='none';by('origin').style.display='none';by('trail').style.display='none'}
}
// Only pouring advances the spout motion; pauses freeze it at the last position.
function spoutX(){if(by('pourPattern').value==='centre')return 425;const pouringTime=segments.reduce((sum,s)=>sum+(s.mass?Math.max(0,Math.min(s.end-s.start,time-s.start)):0),0);return 425+Math.sin(pouringTime*2*Math.PI/(Number(by('circlePeriod').value)||4))*27}
function field(x,y,t){const hit=impact(),jet=spoutX(),dx=x-jet,depth=y-(426-bedDepth()-waterPool*.9),width=hit.width+Math.max(0,depth)*.2;
const down=Math.exp(-((dx/width)**2))*energy*14;
const outward=dx/(width+1)*Math.exp(-((dx/(width*2))**2))*energy*8*Math.exp(-(((y-(426-bedDepth()))/55)**2));
const up=-Math.exp(-(((Math.abs(dx)-width*2)/width)**2))*energy*5;
// Hybrid visual entrainment: irregular, counter-rotating eddies around impact.
// These are procedural visual cues, not resolved turbulence or thermal convection.
let vx=outward,vy=down+up;const bed=426-bedDepth(),surface=Math.max(175,bed-waterPool*.9);
const centreY=Math.min(425,Math.max(surface+22,bed-8)),reach=60+Math.min(40,waterPool*.25);
for(let j=0;j<4;j++){const side=j%2?1:-1,cx=jet+side*(27+12*Math.sin(t*.31+j))+Math.sin(t*.47+j)*8,cy=centreY+(j<2?-18:22)+Math.cos(t*.39+j*1.7)*13;
const rx=x-cx,ry=y-cy,envelope=Math.exp(-(rx*rx+ry*ry)/(reach*reach*.65)),spin=side*(j<2?1:-.65),strength=energy*(.65+.2*Math.sin(t*.63+j));
vx+=-ry*envelope*spin*strength;vy+=rx*envelope*spin*strength;}
return {vx,vy};}
function step(dt){time=Math.min(duration,time+dt);hasStarted=true;let f=flow(),s=activeSegment(),ag=impact().power*2.2;energy+=(f>0?ag-energy:-energy)*Math.min(1,dt*.8);poured=segments.reduce((a,s)=>a+s.mass*Math.max(0,Math.min(1,(time-s.start)/(s.end-s.start))),0);const hold=settings.dose*2*(1-Math.exp(-time/18));const drainRate=Math.max(0,waterPool)*.025+(s.type==='draw'?waterPool/Math.max(.5,duration-time):0);drained=Math.min(Math.max(0,poured-hold),drained+drainRate*dt);waterPool=Math.max(0,poured-drained-hold);updateBed(dt);let bottom=426,bedTop=bottom-bedDepth(),surface=Math.max(175,bedTop-waterPool*.9);for(const p of particles){let v=field(p.x,p.y,time),targetY=bedSurface(p.x)+rand(Math.floor(p.r*1000))*(426-bedSurface(p.x));v.vx+=Math.sin(time*2.7+p.r*31+p.y*.17)*energy*5;v.vy+=Math.cos(time*3.1+p.r*23+p.x*.19)*energy*4;p.vx+=(v.vx-p.vx)*Math.min(1,dt*2);p.vy+=(v.vy+(targetY-p.y)*(.12/(1+energy*3))-p.vy)*Math.min(1,dt*2);p.x+=p.vx*dt*5;p.y+=p.vy*dt*5;const left=215+(p.y-167)*112/257,right=635-(p.y-167)*112/257;if(p.x<left+8){p.x=left+8;p.vx=Math.abs(p.vx)}if(p.x>right-8){p.x=right-8;p.vx=-Math.abs(p.vx)}p.y=Math.max(Math.min(surface+5,bedSurface(p.x)),Math.min(424,p.y));}for(const p of traces){const v=field(p.x,p.y,time);p.x+=v.vx*dt*5;p.y+=v.vy*dt*5;p.life-=dt*.2;if(p.life<0||p.y>426||p.y<surface||p.x<260||p.x>590){p.x=300+Math.random()*250;p.y=surface+Math.random()*(426-surface);p.life=.5+Math.random()*.5}}}
function draw(){ctx.clearRect(0,0,850,canvas.height);ctx.save();ctx.translate(0,160);let depth=bedDepth(),bed=426-depth,surface=Math.max(175,bed-waterPool*.9),f=flow(),jet=spoutX();
ctx.fillStyle='#607568';ctx.font='13px Arial';ctx.fillText('FB45 · simplified cutaway',30,35);ctx.font='11px Arial';ctx.fillText('Flat-bottom wave paper / supported exit zone',30,55);
// Proportions traced from the supplied section, scaled uniformly from its rim width.
ctx.beginPath();ctx.moveTo(175,150);ctx.lineTo(236,272);ctx.quadraticCurveTo(251,300,248,329);ctx.quadraticCurveTo(245,380,217,464);ctx.lineTo(334,464);ctx.lineTo(341,488);ctx.lineTo(509,488);ctx.lineTo(516,464);ctx.lineTo(633,464);ctx.quadraticCurveTo(605,380,602,329);ctx.quadraticCurveTo(599,300,614,272);ctx.lineTo(675,150);ctx.lineTo(665,150);ctx.lineTo(605,270);ctx.lineTo(583,286);ctx.lineTo(583,320);ctx.lineTo(531,431);ctx.lineTo(319,431);ctx.lineTo(267,320);ctx.lineTo(267,286);ctx.lineTo(245,270);ctx.lineTo(185,150);ctx.closePath();ctx.fillStyle='#c4c9bd';ctx.fill();ctx.strokeStyle='#627468';ctx.lineWidth=2;ctx.stroke();
// Filter has straight flat base with pleated walls; coffee and water clipped inside.
function paper(){ctx.beginPath();ctx.moveTo(215,167);ctx.lineTo(327,424);ctx.quadraticCurveTo(330,431,338,431);ctx.lineTo(512,431);ctx.quadraticCurveTo(520,431,523,424);ctx.lineTo(635,167);for(let x=635;x>=215;x-=5)ctx.lineTo(x,158+9*Math.sin((x-215)*Math.PI/25));ctx.closePath()}

paper();ctx.fillStyle='rgba(255,254,241,.55)';ctx.fill();ctx.strokeStyle='#d4d8c5';ctx.lineWidth=1.5;ctx.stroke();ctx.save();paper();ctx.clip();let grad=ctx.createLinearGradient(0,surface,0,465);grad.addColorStop(0,'rgba(147,177,160,.28)');grad.addColorStop(1,'rgba(133,103,62,.45)');ctx.fillStyle=grad;ctx.fillRect(200,surface,450,470-surface);ctx.fillStyle=`rgba(100,66,37,${.26/(1+energy*1.5)})`;ctx.beginPath();ctx.moveTo(200,bed);for(let x=200;x<=650;x+=5)ctx.lineTo(x,bedSurface(x)+Math.sin(x*.07+time*2)*energy*3);ctx.lineTo(650,470);ctx.lineTo(200,470);ctx.closePath();ctx.fill();
ctx.strokeStyle=`rgba(98,65,36,${.45/(1+energy*8)})`;ctx.lineWidth=1.5;ctx.beginPath();for(let x=290;x<=560;x+=3){const y=bedSurface(x)+Math.sin(x*.07+time*2)*energy*3;if(x===290)ctx.moveTo(x,y);else ctx.lineTo(x,y)}ctx.stroke();
if(by('flowVisible').checked&&hasStarted){ctx.strokeStyle='rgba(63,124,127,.48)';ctx.lineWidth=1;for(const p of traces){const v=field(p.x,p.y,time);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-v.vx*.3,p.y-v.vy*.3);ctx.stroke()}}
for(const p of particles){ctx.fillStyle=p.r>2?'rgba(81,60,40,.8)':'rgba(130,97,61,.75)';ctx.beginPath();ctx.ellipse(p.x,p.y,p.r,p.r*.65,p.r,0,Math.PI*2);ctx.fill()}
ctx.strokeStyle='#a8b496';ctx.lineWidth=2;ctx.beginPath();for(let x=200;x<650;x+=4){const y=surface+Math.sin(x*.08+time*3)*Math.min(4,energy*2);if(x===200)ctx.moveTo(x,y);else ctx.lineTo(x,y)}ctx.stroke();ctx.restore();
// Taut wave paper; straight folds touch the ridge tips without conforming to them.
ctx.strokeStyle='rgba(226,229,209,.88)';ctx.lineWidth=1.1;
for(let i=0;i<=14;i++){const u=i/14,topX=215+420*u,baseX=327+196*u;ctx.beginPath();ctx.moveTo(topX,158+9*Math.sin((topX-215)*Math.PI/25));ctx.lineTo(baseX,424);ctx.stroke()}
// Ridge is a circumferential belt halfway down the section.
for(const side of [-1,1]){ctx.save();if(side===1){ctx.translate(850,0);ctx.scale(-1,1)}ctx.beginPath();ctx.moveTo(245,271);ctx.lineTo(267,286);ctx.lineTo(267,320);ctx.lineTo(254,320);ctx.lineTo(254,288);ctx.closePath();ctx.fillStyle='#89998b';ctx.fill();ctx.strokeStyle='#435e50';ctx.lineWidth=1.7;ctx.stroke();ctx.beginPath();ctx.moveTo(266,287);ctx.lineTo(266,318);ctx.strokeStyle='#eff1dd';ctx.lineWidth=2;ctx.stroke();ctx.restore()}
// Long lower receptors, then the shallow exit structure visible in the reference.
ctx.strokeStyle='#718575';ctx.lineWidth=1.4;
for(let i=0;i<9;i++){const u=i/8,topX=278+294*u,baseX=330+190*u;ctx.beginPath();ctx.moveTo(topX-4,329);ctx.quadraticCurveTo(topX,314,topX+4,329);ctx.lineTo(baseX+3,430);ctx.lineTo(baseX-3,430);ctx.closePath();ctx.stroke()}
ctx.beginPath();ctx.moveTo(319,433);ctx.lineTo(531,433);ctx.stroke();
for(const side of [-1,1]){ctx.save();if(side===1){ctx.translate(850,0);ctx.scale(-1,1)}ctx.beginPath();ctx.moveTo(332,435);ctx.quadraticCurveTo(330,458,361,460);ctx.quadraticCurveTo(386,463,387,483);ctx.lineTo(394,483);ctx.lineTo(394,439);ctx.stroke();ctx.restore()}
for(let i=0;i<3;i++){const x=405+i*20;ctx.strokeRect(x-4,435,8,49)}
// Keep all kettle geometry above the rim (y=150), with clearance.
ctx.save();ctx.translate(0,-80-(settings.height-2)*8);
// Hario photo reference: silver S-shaped gooseneck entering from the right.
// The high rounded arch falls gently towards an oblique open lip.
ctx.beginPath();ctx.moveTo(jet+250,175);
ctx.bezierCurveTo(jet+196,201,jet+157,189,jet+126,142);
ctx.bezierCurveTo(jet+93,90,jet+58,77,jet+24,91);
ctx.lineTo(jet+19,103);
ctx.bezierCurveTo(jet+54,91,jet+86,102,jet+115,150);
ctx.bezierCurveTo(jet+151,207,jet+196,219,jet+255,192);ctx.closePath();
const metal=ctx.createLinearGradient(0,80,0,215);metal.addColorStop(0,'#596566');metal.addColorStop(.12,'#e1e5e2');metal.addColorStop(.24,'#f6f7f3');metal.addColorStop(.34,'#7e8988');metal.addColorStop(.55,'#bbc3bf');metal.addColorStop(.72,'#f0f2ed');metal.addColorStop(.9,'#737e7c');metal.addColorStop(1,'#b7c0bb');
ctx.fillStyle=metal;ctx.fill();ctx.strokeStyle='#77827e';ctx.lineWidth=1;ctx.stroke();
ctx.beginPath();ctx.moveTo(jet+250,180);ctx.bezierCurveTo(jet+195,206,jet+155,195,jet+122,146);ctx.bezierCurveTo(jet+91,98,jet+58,84,jet+26,96);ctx.strokeStyle='rgba(255,255,255,.8)';ctx.lineWidth=2;ctx.stroke();
// Dark opening with a thin metal rim, angled towards the falling stream.
ctx.beginPath();ctx.ellipse(jet+22,97,7,3.4,-1.12,0,Math.PI*2);ctx.fillStyle='#283432';ctx.fill();ctx.strokeStyle='#c7ceca';ctx.lineWidth=1.3;ctx.stroke();
ctx.restore();
if(f>0&&hasStarted&&time<duration){
const streamWidth=Math.max(2,Math.min(6,f*.5));
function streamPath(){ctx.beginPath();const tip=20-(settings.height-2)*8;ctx.moveTo(jet+20,tip);ctx.bezierCurveTo(jet+9,tip+11,jet+1,tip+37,jet,tip+58);for(let y=tip+62;y<surface;y+=5)ctx.lineTo(jet+Math.sin(y*.08+time*5)*.35,y);ctx.lineTo(jet,surface)}
ctx.lineCap='round';ctx.strokeStyle='rgba(91,130,139,.45)';ctx.lineWidth=streamWidth+1.5;streamPath();ctx.stroke();
ctx.strokeStyle='rgba(221,239,237,.86)';ctx.lineWidth=streamWidth;streamPath();ctx.stroke();
ctx.strokeStyle='rgba(255,255,255,.9)';ctx.lineWidth=Math.max(.8,streamWidth*.25);streamPath();ctx.stroke();
for(let i=0;i<8;i++){const a=time*6+i*2;ctx.fillStyle='rgba(127,170,177,.6)';ctx.beginPath();ctx.arc(jet+Math.sin(a)*energy*15,surface-5-Math.abs(Math.cos(a))*energy*10,1.5,0,7);ctx.fill()}}
if(hasStarted&&time<duration&&drained>0){ctx.strokeStyle='#9d7442';ctx.lineWidth=2;ctx.setLineDash([4,8]);ctx.lineDashOffset=-time*13;ctx.beginPath();ctx.moveTo(425,490);ctx.lineTo(425,Math.min(750,758-Math.min(225,drained*.9)));ctx.stroke();ctx.setLineDash([])}// Enlarge about the support rim, which remains fixed beneath the brewer.
ctx.save();ctx.translate(425,465);ctx.scale(1.12,1.08);ctx.translate(-425,-465);
// Varia Flow reference: open double-wall server, with its rim supporting the FB45.
// The supporting top rim sits at the brewer's underside (y=464).
function outerServer(){ctx.beginPath();ctx.moveTo(291,465);ctx.bezierCurveTo(295,483,294,510,291,545);ctx.bezierCurveTo(290,618,269,684,250,737);ctx.bezierCurveTo(236,777,254,793,282,795);ctx.quadraticCurveTo(425,806,568,795);ctx.bezierCurveTo(596,793,614,777,600,737);ctx.bezierCurveTo(581,684,560,618,559,545);ctx.bezierCurveTo(556,510,555,483,559,465);ctx.closePath()}
function innerServer(){ctx.beginPath();ctx.moveTo(312,467);ctx.lineTo(312,736);ctx.quadraticCurveTo(312,754,333,755);ctx.quadraticCurveTo(425,764,517,755);ctx.quadraticCurveTo(538,754,538,736);ctx.lineTo(538,467);ctx.closePath()}

ctx.lineWidth=2;ctx.strokeStyle='rgba(102,128,120,.8)';outerServer();ctx.fillStyle='rgba(241,249,245,.16)';ctx.fill();ctx.stroke();
// Coffee is clipped exclusively to the inner chamber; insulating gap remains clear.
ctx.save();innerServer();ctx.clip();const coffeeHeight=Math.min(225,drained*.9),coffeeTop=758-coffeeHeight;const coffee=ctx.createLinearGradient(0,coffeeTop,0,765);coffee.addColorStop(0,'rgba(150,62,27,.55)');coffee.addColorStop(1,'rgba(76,29,15,.8)');ctx.fillStyle=coffee;if(drained>0){ctx.fillRect(306,coffeeTop,238,240);ctx.beginPath();ctx.ellipse(425,coffeeTop,113,4.5,0,0,Math.PI*2);ctx.fillStyle='rgba(181,105,51,.5)';ctx.fill();ctx.strokeStyle='rgba(223,162,102,.7)';ctx.lineWidth=1;ctx.stroke()}ctx.restore();
innerServer();ctx.strokeStyle='rgba(110,138,129,.75)';ctx.lineWidth=1.7;ctx.stroke();
// Glass wall highlights make the empty double-wall space legible.
ctx.beginPath();ctx.moveTo(282,491);ctx.bezierCurveTo(302,565,272,689,260,735);ctx.strokeStyle='rgba(255,255,255,.8)';ctx.lineWidth=4;ctx.stroke();ctx.beginPath();ctx.moveTo(548,481);ctx.lineTo(548,733);ctx.strokeStyle='rgba(255,255,255,.65)';ctx.lineWidth=3;ctx.stroke();ctx.beginPath();ctx.moveTo(285,787);ctx.quadraticCurveTo(425,798,563,787);ctx.strokeStyle='rgba(153,174,162,.5)';ctx.lineWidth=2;ctx.stroke();
// Continuous top rim: brewer rests on it; the centre outlet projects inside.
ctx.beginPath();ctx.moveTo(291,465);ctx.quadraticCurveTo(425,458,559,465);ctx.quadraticCurveTo(425,472,291,465);ctx.strokeStyle='#8ba398';ctx.lineWidth=2.4;ctx.stroke();ctx.beginPath();ctx.moveTo(293,465);ctx.quadraticCurveTo(276,454,274,465);ctx.quadraticCurveTo(286,469,294,483);ctx.strokeStyle='#8ba398';ctx.lineWidth=2;ctx.stroke();

ctx.restore();
ctx.fillStyle='#627468';ctx.font='12px Arial';ctx.fillText('Ridge / paper contact',35,288);ctx.fillText('Wave paper',635,260);ctx.fillText('Coffee bed',640,395);ctx.fillText('Exit supports',60,470);ctx.strokeStyle='#a4afa0';ctx.lineWidth=1;[[161,286,266,298],[631,256,600,259],[633,391,533,398],[145,467,357,459]].forEach(a=>{ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(a[2],a[3]);ctx.stroke()});ctx.restore();}
function loop(now){const realDt=Math.min(.05,(now-last)/1000||0);last=now;if(running){const dt=realDt*+by('simSpeed').value;for(let n=0;n<4;n++)step(dt/4);if(time>=duration){running=false;by('simPlay').textContent='↻ Brew again'}updateUI();draw()}frameId=requestAnimationFrame(loop)}
function choose(name){recipe=name;by('presetStatus').textContent=savedPresets[name]?'Your saved '+name+' recipe.':'Original '+name+' recipe.';['mild','medium','bold'].forEach(k=>{const button=by('chart'+k[0].toUpperCase()+k.slice(1));button.classList.toggle('active',k===name);button.setAttribute('aria-pressed',String(k===name))});if(typeof load==='function')load(name);Object.entries(recipes[name]).forEach(([k,v])=>{if(by('brew_'+k))by('brew_'+k).value=v});['mild','medium','bold'].forEach(k=>{by('sim'+k[0].toUpperCase()+k.slice(1)).classList.toggle('active',k===name);by('sim'+k[0].toUpperCase()+k.slice(1)).setAttribute('aria-pressed',String(k===name))});configure()}
['mild','medium','bold'].forEach(k=>{by('sim'+k[0].toUpperCase()+k.slice(1)).onclick=()=>choose(k);by('chart'+k[0].toUpperCase()+k.slice(1)).onclick=()=>choose(k)});definitions.forEach(([id])=>by('brew_'+id).oninput=()=>{configure();by('presetStatus').textContent='Unsaved changes to your '+recipe+' recipe.'});by('simPlay').onclick=()=>{if(time>=duration)restart();running=!running;hasStarted=true;by('simPlay').textContent=running?'Ⅱ Pause':'▶ Continue';if(reduced&&running){while(time<duration)step(.5);running=false;updateUI();draw();by('simPlay').textContent='↻ Brew again'}};by('savePreset').onclick=()=>{const current={...settings};savedPresets[recipe]=current;recipes[recipe]={...current};try{localStorage.setItem(presetKey,JSON.stringify(savedPresets));by('presetStatus').textContent='Saved your '+recipe+' recipe in this browser.'}catch{by('presetStatus').textContent='Preset updated for this session. Browser storage is unavailable.'}};
by('restorePreset').onclick=()=>{delete savedPresets[recipe];recipes[recipe]={...defaultRecipes[recipe]};let persisted=true;try{localStorage.setItem(presetKey,JSON.stringify(savedPresets))}catch{persisted=false}choose(recipe);by('presetStatus').textContent='Original '+recipe+' recipe restored.'+(persisted?'':' Browser storage is unavailable; reset applies to this session.');};
by('applyActual').onclick=()=>{const tds=Number(by('actualTDS').value),mass=Number(by('actualMass').value),dose=Number(by('actualDose').value),ey=tds*mass/dose;if(!Number.isFinite(ey)||tds<=0||tds>10||mass<=0||dose<=0||ey<=0||ey>100){by('actualError').textContent='Enter valid positive TDS, beverage weight and dose measurements.';return}running=false;by('simPlay').textContent='▶ Continue';actualBrew={tds,mass,dose,ey};by('actualError').textContent=(ey<14||ey>26||tds<.6||tds>1.8)?'Measured result is outside the displayed chart range. Check the values; use the numbers below for the exact result.':'';updateUI()};by('simRestart').onclick=restart;by('toggleServer').onclick=()=>{showFullServer=!showFullServer;canvas.height=showFullServer?1010:780;canvas.classList.toggle('serverExpanded',showFullServer);by('toggleServer').textContent=showFullServer?'Hide full server':'Show full server';by('toggleServer').setAttribute('aria-expanded',String(showFullServer));draw()};by('circlePeriod').oninput=()=>{by('circlePeriodVal').textContent=Number(by('circlePeriod').value).toFixed(1)+' s';restart()};by('pourPattern').onchange=()=>{restart()};by('flowVisible').onchange=draw;by('simScrub').oninput=()=>{let target=+by('simScrub').value/1000*duration;restart();hasStarted=true;while(time<target)step(Math.min(.25,target-time));updateUI();draw();by('simPlay').textContent='▶ Continue'};window.setActualDisplay=enabled=>{if(!enabled)actualBrew=null;updateUI()};window.startBrewerSimulation=name=>{choose(name);by('simPlay').click()};choose('medium');requestAnimationFrame(loop);
})();
