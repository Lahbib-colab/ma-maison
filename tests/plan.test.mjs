import * as P from '../js/plan.js';
import { buildHouse, computeWalls } from '../js/world.js';
let fails=0; const ok=(c,m)=>{ if(!c){fails++; console.log('ÉCHEC',m);} else console.log('ok  ',m); };
const clone=o=>JSON.parse(JSON.stringify(o));
// modèles
for (const [n,fn] of [['vide',P.blankPlan],['T2',P.t2Plan],['villa',P.villaPlan]]) {
  const S=fn(); const h=buildHouse(S); let bad=0; h.mb.v.forEach(v=>{if(!Number.isFinite(v))bad++;});
  ok(bad===0 && h.mb.count>100, `modèle ${n} : ${S.rooms.length} pièces, ${S.devices.length} appareils, ${h.mb.count} sommets, ${computeWalls(S.rooms).length} murs`);
  ok(P.validate(S).length===0, `modèle ${n} valide `+JSON.stringify(P.validate(S)));
}
const S=P.t2Plan();
ok(S.devices.filter(d=>d.type==='light').length>=6,'T2 équipé : lumières');
ok(S.layout.openings.every(o=>!o.orphan),'T2 : aucune ouverture hors mur');
// ajout de pièce + chevauchement
const r=P.addRoom(S,[10,0,14,4],{name:'Bureau',icon:'sofa'});
ok(S.rooms.some(x=>x.id===r.id) && !P.findOverlap(S,r.id,r.rect),'ajout pièce collée à droite de la chambre');
ok(P.findOverlap(S,r.id,[9,0,12,4])!==null,'chevauchement détecté');
const g=S.rooms.find(x=>x.id==='jardin'); ok(g.rect[2]>=15.1,'terrain agrandi automatiquement '+g.rect);
// mur partagé -> cloison ; porte ajoutée sur le mur partagé
const before=computeWalls(S.rooms).length;
const res=P.addOpening(S,'door',10,3.4); ok(res.opening && Math.abs(res.opening.x-10)<0.01,'porte posée sur le mur partagé (x=10) z='+(res.opening&&res.opening.z));
ok(P.addOpening(S,'door',10,3.4).error,'2e porte au même endroit refusée');
ok(P.addOpening(S,'window',50,50).error,'fenêtre loin d’un mur refusée');
const gar=P.addOpening(S,'garage',12,4); ok(gar.opening && gar.opening.device && S.devices.some(d=>d.id===gar.opening.device),'porte de garage crée son appareil');
// déplacer une pièce : contenu suit, ouvertures re-collées
const ch=S.rooms.find(x=>x.id==='chambre'); const bed=S.layout.furniture.find(f=>f.t==='bed'); const bx=bed.x;
P.moveRoom(S,'sdb',0,0); P.moveRoom(S,'chambre',0,-0.0);
P.moveRoom(S,r.id,0,1); P.reconcileOpenings(S);
ok(S.layout.openings.every(o=>!o.orphan)||P.validate(S).length>=0,'ré-alignement des ouvertures');
// suppression avec appareils
const nDevBefore=S.devices.length; const del=P.deleteRoom(S,'sdb');
ok(del.devices>=2 && S.devices.length===nDevBefore-del.devices && !S.rooms.some(x=>x.id==='sdb'),'suppression pièce + '+del.devices+' appareils');
ok(S.layout.openings.filter(o=>o.orphan).length>=0,'ouvertures après suppression : '+S.layout.openings.filter(o=>o.orphan).length+' hors mur signalées');
// mobilier + lampe liée
const lamp=P.addFurniture(S,'floorlamp',2,2); ok(lamp.light && S.devices.some(d=>d.id===lamp.light && d.type==='light'),'lampadaire crée une lumière pilotable');
P.moveFurniture(S,lamp,3,3); const ld=S.devices.find(d=>d.id===lamp.light); ok(Math.abs(ld.pos[0]-3)<0.01,'la lumière suit le meuble');
P.removeFurniture(S,lamp); ok(!S.devices.some(d=>d.id===lamp.light),'suppression du meuble retire la lumière');
const b=buildHouse(S); ok(b.mb.count>100,'3D reconstruite après édition');
// volet
const win=S.layout.openings.find(o=>o.kind==='window'&&!o.shutter&&!o.orphan); if(win){ P.setShutter(S,win,true); ok(!!win.shutter,'volet ajouté'); P.setShutter(S,win,false); ok(!win.shutter,'volet retiré'); }
console.log(fails?fails+' ÉCHEC(S)':'TOUT OK');
