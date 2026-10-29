import test from 'node:test';
import assert from 'node:assert/strict';
import {ROOM_RECOVERY_KEY,readRoomRecoveries,saveRoomRecovery,removeRoomRecovery} from '../src/room-recovery.js';
const makeStore=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v)};};
const first={room:'ABCD2345',me:'host-id',role:'host',token:'00000000-0000-4000-8000-000000000001'};
test('closing a tab retains only a room-scoped identity handle, preserving independent clients',()=>{
 const storage=makeStore();saveRoomRecovery(storage,{...first,game:{secret:'forbidden'},state:{hand:['forbidden']}},100);
 const second={...first,me:'guest-id',role:'guest',token:'00000000-0000-4000-8000-000000000002'};
 saveRoomRecovery(storage,second,200);
 assert.equal(readRoomRecoveries(storage).length,2);
 assert.equal(readRoomRecoveries(storage)[0].token,second.token);
 assert.ok(!storage.getItem(ROOM_RECOVERY_KEY).includes('forbidden'));
 assert.deepEqual(readRoomRecoveries(storage,'WXYZ6789'),[]);
 removeRoomRecovery(storage,first.room,first.token);
 assert.equal(readRoomRecoveries(storage).length,1);assert.equal(readRoomRecoveries(storage)[0].me,'guest-id');
});
test('persistent return reader prunes injected game fields and handles unavailable storage',()=>{
 const storage=makeStore();storage.setItem(ROOM_RECOVERY_KEY,JSON.stringify([{...first,updatedAt:1,game:{randomKey:'forbidden'}}]));
 assert.equal(readRoomRecoveries(storage)[0].game,undefined);
 assert.deepEqual(readRoomRecoveries({getItem(){throw Error('blocked');}}),[]);
});
