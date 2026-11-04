import { configFrom } from '../src/config.js';
import { Repository } from '../src/repository.js';
const repo = new Repository(configFrom());
try { await repo.requireReady(); await repo.purge(); console.log('Registros expirados removidos.'); } finally { await repo.close(); }
