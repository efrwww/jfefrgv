import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type {Dataset,ChainEvent,Evidence,Alert,Report} from '../shared/types.ts';
import type {BackendAccount,BackendAccountRole} from '../shared/accounts.ts';

export class Store {
  db:DatabaseSync;
  constructor(file=process.env.DATABASE_PATH||'data/today-gym.sqlite'){
    if(file!==':memory:')fs.mkdirSync(path.dirname(file),{recursive:true});
    this.db=new DatabaseSync(file);this.db.exec(`
      PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS datasets(id TEXT PRIMARY KEY,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,dataset TEXT NOT NULL,block INTEGER NOT NULL,tx TEXT NOT NULL,log INTEGER NOT NULL,json TEXT NOT NULL,UNIQUE(dataset,tx,log));
      CREATE INDEX IF NOT EXISTS idx_events_dataset_block ON events(dataset,block);
      CREATE TABLE IF NOT EXISTS blocks(dataset TEXT NOT NULL,number INTEGER NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(dataset,number));
      CREATE TABLE IF NOT EXISTS checkpoints(dataset TEXT PRIMARY KEY,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY,dataset TEXT NOT NULL,json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_evidence_dataset ON evidence(dataset);
      CREATE TABLE IF NOT EXISTS alerts(id TEXT PRIMARY KEY,dataset TEXT NOT NULL,json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_alerts_dataset ON alerts(dataset);
      CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,dataset TEXT NOT NULL,json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_reports_dataset ON reports(dataset);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,dataset TEXT NOT NULL,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts(
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL CHECK(role IN ('member','merchant')),
        display_name TEXT NOT NULL,
        address TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        network TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active','disabled')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(chain_id,address)
      );
      CREATE INDEX IF NOT EXISTS idx_accounts_role ON accounts(role);
      PRAGMA optimize;
    `);
  }
  encode(value:unknown){return JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v);}
  put(table:'datasets'|'evidence'|'alerts'|'reports'|'jobs',value:any){
    if(table==='datasets')this.db.prepare('INSERT OR REPLACE INTO datasets(id,json) VALUES (?,?)').run(value.id,this.encode(value));
    else this.db.prepare(`INSERT OR REPLACE INTO ${table}(id,dataset,json) VALUES (?,?,?)`).run(value.id,value.datasetId,this.encode(value));
  }
  get<T=any>(table:'datasets'|'evidence'|'alerts'|'reports'|'jobs',id:string):T|undefined{
    const row=this.db.prepare(`SELECT json FROM ${table} WHERE id=?`).get(id) as {json:string}|undefined;return row?JSON.parse(row.json):undefined;
  }
  list<T=any>(table:'datasets'|'evidence'|'alerts'|'reports'|'jobs',dataset?:string):T[]{
    const rows=dataset&&table!=='datasets'?this.db.prepare(`SELECT json FROM ${table} WHERE dataset=? ORDER BY rowid DESC`).all(dataset):this.db.prepare(`SELECT json FROM ${table} ORDER BY rowid DESC`).all();
    return (rows as {json:string}[]).map(r=>JSON.parse(r.json));
  }
  upsertAccount(account:BackendAccount){
    this.db.prepare('INSERT INTO accounts(id,role,display_name,address,chain_id,network,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET role=excluded.role,display_name=excluded.display_name,address=excluded.address,chain_id=excluded.chain_id,network=excluded.network,status=excluded.status,updated_at=excluded.updated_at')
      .run(account.id,account.role,account.displayName,account.address,account.chainId,account.network,account.status,account.createdAt,account.updatedAt);
  }
  accounts(role?:BackendAccountRole):BackendAccount[]{
    const rows=(role?this.db.prepare('SELECT * FROM accounts WHERE role=? ORDER BY id').all(role):this.db.prepare('SELECT * FROM accounts ORDER BY role,id').all()) as any[];
    return rows.map(row=>({id:row.id,role:row.role,displayName:row.display_name,address:row.address,chainId:Number(row.chain_id),network:row.network,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at}));
  }
  account(id:string){const row=this.db.prepare('SELECT * FROM accounts WHERE id=?').get(id) as any;return row?({id:row.id,role:row.role,displayName:row.display_name,address:row.address,chainId:Number(row.chain_id),network:row.network,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at} as BackendAccount):undefined;}
  events(dataset:string):ChainEvent[]{return (this.db.prepare('SELECT json FROM events WHERE dataset=? ORDER BY block,log').all(dataset) as {json:string}[]).map(r=>JSON.parse(r.json));}
  checkpoint(dataset:string):any{const r=this.db.prepare('SELECT json FROM checkpoints WHERE dataset=?').get(dataset) as {json:string}|undefined;return r?JSON.parse(r.json):undefined;}
  checkpointPut(dataset:string,value:unknown){this.db.prepare('INSERT OR REPLACE INTO checkpoints(dataset,json) VALUES (?,?)').run(dataset,this.encode(value));}
  transaction(fn:()=>void){this.db.exec('BEGIN IMMEDIATE');try{fn();this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}}
  addEvent(event:ChainEvent){this.db.prepare('INSERT OR IGNORE INTO events(id,dataset,block,tx,log,json) VALUES (?,?,?,?,?,?)').run(event.id,event.datasetId,event.blockNumber,event.txHash,event.logIndex,this.encode(event));}
  updateEvent(event:ChainEvent){this.db.prepare('UPDATE events SET json=? WHERE id=? AND dataset=?').run(this.encode(event),event.id,event.datasetId);}
  block(dataset:string,n:number,hash:string){this.db.prepare('INSERT OR REPLACE INTO blocks(dataset,number,hash) VALUES (?,?,?)').run(dataset,n,hash);}
  rollback(dataset:string,ancestor:number){this.transaction(()=>{
    this.db.prepare('DELETE FROM events WHERE dataset=? AND block>?').run(dataset,ancestor);
    this.db.prepare('DELETE FROM blocks WHERE dataset=? AND number>?').run(dataset,ancestor);
    this.db.prepare('DELETE FROM alerts WHERE dataset=?').run(dataset);
    for(const e of this.list<Evidence>('evidence',dataset))if(e.asOfBlock>ancestor)this.db.prepare('DELETE FROM evidence WHERE id=? AND dataset=?').run(e.id,dataset);
    // ChainService has actually matched the ancestor hash. Evidence and reports
    // at or before that block still refer to the canonical shared history.
    // A reset without a matched deployment ancestor still invalidates them all.
    for(const report of this.list<Report>('reports',dataset))if(report.asOfBlock>ancestor)this.put('reports',{...report,status:'stale',limitations:[...new Set([...report.limitations,'链重组或本地重置，须重新调查。'])]});
    this.checkpointPut(dataset,{blockNumber:ancestor,coverageComplete:false,reorgDetected:true});
  });}
  close(){this.db.close();}
}
