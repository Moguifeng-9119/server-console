import {describe, it, expect} from 'vitest';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import {ForwardingManager} from '../electron/forwardings.cjs';

const listen = (server) => new Promise((resolve, reject) => {server.once('error', reject);server.listen(0, '127.0.0.1', () => resolve(server.address().port));});
async function fixture(run) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sc-forward-test-'));
  const sockets=new Set();
  const echo=net.createServer((socket)=>{sockets.add(socket);socket.on('error',()=>{});socket.pipe(socket);});
  const remotePort=await listen(echo), reserve=net.createServer();
  const localPort=await listen(reserve);await new Promise(resolve=>reserve.close(resolve));
  const getConn = async () => ({
    connect: async () => {},
    client: {forwardOut: (_source, _port, host, port, cb) => {
      const stream = net.connect(port, host); sockets.add(stream);
      stream.once('connect', () => cb(null, stream)); stream.once('error', cb);
    }},
  });
  const manager = new ForwardingManager({dataDir: dir, getConn});
  try {await run({manager,remotePort,localPort,sockets});}
  finally {for(const socket of sockets)socket.destroy();for(const id of [...manager.servers.keys()])await manager.stop(id);await new Promise(resolve=>echo.close(resolve));if(path.dirname(dir)===os.tmpdir()&&path.basename(dir).startsWith('sc-forward-test-'))fs.rmSync(dir,{recursive:true,force:true});}
}
async function openAndEcho(port,sockets) {
  const socket=net.connect(port,'127.0.0.1');sockets.add(socket);
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
  const result=new Promise((resolve,reject)=>{socket.once('data',resolve);socket.once('error',reject);});
  socket.write('forwarding fixture');expect((await result).toString()).toBe('forwarding fixture');return socket;
}
describe('forwarding lifecycle',()=>{
  it.each(['stop','disable','remove'])('cancels pending connection setup when requested to %s',async(action)=>fixture(async({manager,remotePort,localPort})=>{
    let release, entered;
    const gate=new Promise(resolve=>{release=resolve;}), ready=new Promise(resolve=>{entered=resolve;});
    const getConn=manager.getConn;
    manager.getConn=async(id)=>{entered();await gate;return getConn(id);};
    const rule={id:'pending',serverId:'fixture',localPort,remoteHost:'127.0.0.1',remotePort,enabled:true};
    const starting=manager.upsert(rule);await ready;
    try {
      if(action==='stop')await manager.stop(rule.id);
      else if(action==='disable')await manager.upsert({...rule,enabled:false});
      else await manager.remove(rule.id);
    } finally {release();}
    await starting;
    expect(manager.servers.size).toBe(0);expect(manager.listenerQueues.size).toBe(0);
    if(action==='remove')expect(manager.list()).toEqual([]);
    else {expect(manager.list()[0].status).toBe('stopped');if(action==='disable')expect(manager.list()[0].enabled).toBe(false);}
  }),10000);
  it('cancels a pending SSH handshake even if it later rejects',async()=>fixture(async({manager,remotePort,localPort})=>{
    let rejectConnect, entered;const ready=new Promise(resolve=>{entered=resolve;});
    manager.getConn=async()=>({connect:()=>{entered();return new Promise((_,reject)=>{rejectConnect=reject;});},client:null});
    const starting=manager.upsert({id:'handshake',serverId:'fixture',localPort,remoteHost:'127.0.0.1',remotePort,enabled:true});
    await ready;await manager.stop('handshake');rejectConnect(new Error('cancelled fixture handshake'));await starting;
    expect(manager.servers.size).toBe(0);expect(manager.list()[0].status).toBe('stopped');
  }),10000);
  it('closes a local socket when its SSH channel closes without an error',async()=>fixture(async({manager,remotePort,localPort,sockets})=>{
    const channel=new PassThrough();
    manager.getConn=async()=>({connect:async()=>{},client:{forwardOut:(_a,_b,_c,_d,cb)=>cb(null,channel)}});
    await manager.upsert({serverId:'fixture',localPort,remoteHost:'127.0.0.1',remotePort,enabled:true});
    const client=await openAndEcho(localPort,sockets);const closed=new Promise(resolve=>client.once('close',resolve));
    channel.destroy();await closed;expect(client.destroyed).toBe(true);
  }),10000);
  it('destroys a late SSH channel after the local client has been stopped',async()=>fixture(async({manager,remotePort,localPort,sockets})=>{
    let callback, entered;const ready=new Promise(resolve=>{entered=resolve;});
    manager.getConn=async()=>({connect:async()=>{},client:{forwardOut:(_a,_b,_c,_d,cb)=>{callback=cb;entered();}}});
    const id=await manager.upsert({serverId:'fixture',localPort,remoteHost:'127.0.0.1',remotePort,enabled:true});
    const client=net.connect(localPort,'127.0.0.1');sockets.add(client);client.on('error',()=>{});
    await ready;const closed=new Promise(resolve=>client.once('close',resolve));await manager.stop(id);await closed;
    const channel=new PassThrough();callback(null,channel);expect(channel.destroyed).toBe(true);
  }),10000);
  it('stops active forwarding connections instead of waiting indefinitely for clients',async()=>fixture(async({manager,remotePort,localPort,sockets})=>{
    const id=await manager.upsert({serverId:'fixture',localPort,remoteHost:'127.0.0.1',remotePort,enabled:true});
    const client=await openAndEcho(localPort,sockets);
    const closed=new Promise(resolve=>client.once('close',resolve));
    let timer;const stopped=await Promise.race([manager.stop(id).then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),1000);})]);clearTimeout(timer);
    expect(stopped,'stop must close active tunnels promptly').toBe(true);await closed;
    expect(manager.list()[0].status).toBe('stopped');
  }),10000);
  it('replaces an active rule without hanging and accepts a new client',async()=>fixture(async({manager,remotePort,localPort,sockets})=>{
    const rule={serverId:'fixture',localPort,remoteHost:'127.0.0.1',remotePort,enabled:true};
    const id=await manager.upsert(rule); const client=await openAndEcho(localPort,sockets);
    const closed=new Promise(resolve=>client.once('close',resolve));
    let timer;const changed=await Promise.race([manager.upsert({...rule,id}).then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),1000);})]);clearTimeout(timer);
    expect(changed,'updating an active rule must complete').toBe(true);await closed;
    await openAndEcho(localPort,sockets);expect(manager.list()[0].status).toBe('listening');
  }),10000);
});
