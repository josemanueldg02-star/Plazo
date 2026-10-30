import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { FileStore, MemoryStore } from './store.js';

const config = loadConfig();
const store = config.dataFile ? await new FileStore(config.dataFile).load() : new MemoryStore();
const log = (entry) => process.stdout.write(JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n');
const { server } = createApp(config, store, { log });

server.listen(config.port, config.host, () => {
  log({ level: 'info', msg: 'plazo-sync escuchando', host: config.host, port: config.port, persistente: Boolean(config.dataFile) });
});

function shutdown(signal) {
  log({ level: 'info', msg: 'apagando', signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
