import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from '../packages/database/store.ts';
import { AnalysisService } from '../packages/core/analysis-service.ts';
import { AutomaticAnalysisCoordinator } from '../packages/core/automatic-analysis.ts';
import { WhatsAppConversationArchive } from '../packages/whatsapp/conversation-archive.ts';
import { loadConfig } from '../apps/server/src/config.ts';

if(!process.argv.includes('--apply')) throw new Error('Use --apply para reparar com backup; o servidor precisa estar parado.');
const config=loadConfig();
for(const port of new Set([4318,4321,config.port])) {
  let responding=false;
  try {responding=(await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)})).ok;} catch {}
  if(responding) throw new Error('SERVER_MUST_BE_STOPPED');
}
const backupDirectory=resolve(config.dataDir,'backups');
mkdirSync(backupDirectory,{recursive:true});
const backupPath=resolve(backupDirectory,`${config.mode}-before-reliability-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
const original=new DatabaseSync(config.databasePath);
original.prepare('VACUUM INTO ?').run(backupPath);
original.close();
const store=new Store(config.databasePath);
try {
  const analyzer=new AnalysisService(store,{...config.analyzer,enabled:false});
  const coordinator=new AutomaticAnalysisCoordinator(store,analyzer);
  const admin=store.db.prepare("SELECT id FROM employees WHERE active=1 AND role='admin' ORDER BY id LIMIT 1").get();
  if(!admin) throw new Error('ADMIN_NOT_FOUND');
  const retry=coordinator.retryFailed({id:String(admin.id),role:'admin'});
  const recovery=coordinator.enqueueHistoricalRecovery(config.whatsapp.accountId);
  const archived=new WhatsAppConversationArchive(store,resolve(config.dataDir,'conversas-clientes')).refreshAll();
  console.log(JSON.stringify({backupPath,requeued:retry.queued,recoveryBatches:recovery,archived,integrity:store.db.prepare('PRAGMA integrity_check').all(),foreignKeys:store.db.prepare('PRAGMA foreign_key_check').all()}));
} finally {store.close();}
