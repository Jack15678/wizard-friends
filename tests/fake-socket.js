import { EventEmitter } from 'node:events';
export class FakeSocket extends EventEmitter {
  static instances = [];
  readyState = 0;
  sent = [];
  constructor(url) { super(); this.url = url; FakeSocket.instances.push(this); }
  addEventListener(event, fn) { this.on(event, fn); }
  send(raw) { if (this.readyState !== 1) throw new Error('closed'); this.sent.push(raw === 'ping' ? raw : JSON.parse(raw)); }
  open() { this.readyState = 1; this.emit('open'); }
  receive(message) { this.emit('message', { data: typeof message === 'string' ? message : JSON.stringify(message) }); }
  close() { this.readyState = 3; this.emit('close'); }
}
