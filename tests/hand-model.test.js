import test from 'node:test';
import assert from 'node:assert/strict';
import { relativeSeat, seatPosition, targetStatus, isSwipe, playBlockedReason, sortCards, desktopFan, compactPlayedPosition } from '../src/hand-model.js';
import { savePractice, readPractice, PRACTICE_SAVE_KEY, PRACTICE_KEEP_MS } from '../src/practice-save.js';
test('3–6 seats keep the viewer below without changing action indices', () => {
  for (let n = 3; n <= 6; n++) for (let self = 0; self < n; self++) {
    assert.deepEqual(Array.from({ length: n }, (_, i) => relativeSeat(i, self, n)).sort((a,b)=>a-b), Array.from({length:n},(_,i)=>i));
    assert.equal(seatPosition(self, self, n).y, 90);
  }
});
test('target text distinguishes provisional match and round success without hidden targets', () => {
  assert.equal(targetStatus({bid:2,won:2}).text, '暂时达标');
  assert.equal(targetStatus({bid:2,won:2},true).text, '本轮成功');
  assert.equal(targetStatus({bid:null,won:2}).state, 'unknown');
});
test('drag threshold rejects swipes and sorting does not mutate authoritative hand', () => {
  assert.equal(isSwipe({x:0,y:0},{x:11,y:0}),true);
  assert.equal(isSwipe({x:0,y:0},{x:2,y:3}),false);
  const cards=[{id:'a',kind:'number',suit:'red',rank:13},{id:'b',kind:'number',suit:'blue',rank:1}];
  assert.equal(sortCards(cards)[0].id,'b');assert.equal(cards[0].id,'a');
});
test('permission changes make a selected card unplayable during pause, disconnect recovery, or next turn', () => {
  const s={phase:'play',turn:0,players:[{id:'me'},{id:'other'}],legal:['c'],lifecycle:{}};
  assert.equal(playBlockedReason(s,'me',{id:'c'}),'');
  s.lifecycle.paused=true;assert.match(playBlockedReason(s,'me',{id:'c'}),/暂停/);
  s.lifecycle.paused=false;s.turn=1;assert.match(playBlockedReason(s,'me',{id:'c'}),/尚未轮到/);
});
test('practice pause cannot extend a fixed ten minute browser return window', () => {
  const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const saved={me:'me',game:{players:[{id:'me'}],turnDeadline:5000}};
  savePractice(storage,saved,1000,true);savePractice(storage,saved,2000,true);
  assert.equal(JSON.parse(values.get(PRACTICE_SAVE_KEY)).leftAt,1000);
  assert.ok(readPractice(storage,1000+PRACTICE_KEEP_MS-1));
  assert.equal(readPractice(storage,1000+PRACTICE_KEEP_MS),null);
});

test('desktop shallow fan adapts few, fifteen, and twenty unique cards within its viewport',()=>{
 for(const count of [1,5,15,20]) {
  const fan=desktopFan(count,880,2,3);
  assert.equal(fan.poses.length,count);assert.ok(fan.cardWidth>=74);
  assert.ok(fan.poses.every(p=>p.x>=0 && p.x+fan.cardWidth<=880 && Math.abs(p.angle)<=12));
  if(count>=15)assert.ok(fan.step>=30);
 }
 const fan=desktopFan(20,880,3,4);
 assert.equal(fan.poses[3].lift,-19);assert.equal(fan.poses[4].lift,-14);
 assert.equal(fan.poses[2].push,-10);assert.equal(fan.poses[5].push,10);
});

test('compact played slots keep real seat identity and use two columns for six cards',()=>{
 for(const width of [360,390]) for(const count of [3,4,5,6]) {
  const points=Array.from({length:count},(_,i)=>compactPlayedPosition(i,0,count,width));
  assert.equal(new Set(points.map(p=>`${p.x}:${p.y}`)).size,count);
  assert.ok(points.every(p=>p.x*width/100-28>=118 && p.x*width/100+28<=width-118));
  for(let self=0;self<count;self++)assert.equal(compactPlayedPosition(self,self,count,width).seat,0);
 }
 const six=Array.from({length:6},(_,i)=>compactPlayedPosition(i,0,6,390));
 assert.equal(new Set(six.map(p=>p.x)).size,2);
});
