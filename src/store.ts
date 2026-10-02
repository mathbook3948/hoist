import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, chmodSync, lstatSync, readdirSync, unlinkSync, realpathSync } from 'node:fs';
import { resolve, join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
export type Account = { username: string; passwordHash: string };
export type Project = { id: string; name: string; script: string; timeoutSeconds: number };
export type Config = { version: 1; host: string; port: number; publicOrigin: string | null; maxArtifactBytes: number; maxStorageBytes: number; artifactRetention: number; historyRetention: number; maxLogBytes: number; sessionHours: number; accounts: Account[]; projects: Project[] };
export type Artifact = { id: string; name: string; size: number; createdAt: string };
export type Deployment = { id: string; artifactId: string; version: string; status: 'running'|'succeeded'|'failed'|'cancelled'|'timed_out'|'interrupted'; startedAt: string; finishedAt?: string; exitCode?: number|null };
export type State = { artifacts: Artifact[]; deployments: Deployment[] };
export const validId = (v: string) => /^[a-zA-Z0-9_-]{1,64}$/.test(v);
export function atomicJSON(path: string, value: unknown) { const tmp = `${path}.${randomUUID()}.tmp`; writeFileSync(tmp, JSON.stringify(value, null, 2)+'\n', {mode:0o600,flag:'wx'}); renameSync(tmp,path); }
export function readJSON(path: string) { if(lstatSync(path).size>1024*1024) throw new Error('Configuration/state too large'); return JSON.parse(readFileSync(path,'utf8')); }
export function initData(input: string) {
 let dir=resolve(input); mkdirSync(dir,{recursive:true,mode:0o700}); if(lstatSync(dir).isSymbolicLink()) throw new Error('Data directory must not be a symlink'); dir=realpathSync(dir); chmodSync(dir,0o700);
 const configPath=join(dir,'config.json');
 if(!existsSync(configPath)) atomicJSON(configPath,{version:1,host:'127.0.0.1',port:3000,publicOrigin:null,maxArtifactBytes:100*1024*1024,maxStorageBytes:512*1024*1024,artifactRetention:5,historyRetention:30,maxLogBytes:64*1024,sessionHours:8,accounts:[],projects:[]} satisfies Config);
 const config:Config=readJSON(configPath); validate(config); mkdirSync(join(dir,'projects'),{mode:0o700,recursive:true}); return {dir,configPath,config};
}
function validate(c: Config) {
 if(c.version!==1 || !Array.isArray(c.accounts) || !Array.isArray(c.projects) || c.accounts.length>32 || c.projects.length>32) throw new Error('Invalid config version/accounts/projects');
 if(!['127.0.0.1','::1','localhost'].includes(c.host) && !c.publicOrigin) throw new Error('Non-loopback binding requires an explicit HTTPS publicOrigin and protected reverse proxy');
 if(c.publicOrigin && (new URL(c.publicOrigin).origin!==c.publicOrigin || new URL(c.publicOrigin).protocol!=='https:')) throw new Error('publicOrigin must be an HTTPS origin with no path');
 for(const [key,min,max] of [['port',1,65535],['maxArtifactBytes',1,1024*1024*1024],['maxStorageBytes',1,16*1024*1024*1024],['artifactRetention',1,100],['historyRetention',1,100],['maxLogBytes',1024,1024*1024],['sessionHours',1,24]] as const) if(!Number.isInteger(c[key])||c[key]<min||c[key]>max) throw new Error(`Invalid ${key}`);
 const usernames=new Set(); for(const a of c.accounts) {if(!validId(a.username)||typeof a.passwordHash!=='string'|| !/^\$2[aby]\$/.test(a.passwordHash)||usernames.has(a.username)) throw new Error('Invalid/duplicate account'); usernames.add(a.username);}
 const ids=new Set(); for(const p of c.projects) {if(!validId(p.id)||ids.has(p.id)||typeof p.name!=='string'||p.name.length>100||!isAbsolute(p.script)||!Number.isInteger(p.timeoutSeconds)||p.timeoutSeconds<1||p.timeoutSeconds>3600) throw new Error('Invalid/duplicate project'); ids.add(p.id); if(p.script.startsWith(join(resolve('.'),'public'))) throw new Error('Scripts must not be web assets');}
}
export function projectDir(dir:string,id:string) {if(!validId(id)) throw new Error('Invalid project'); return join(dir,'projects',id);}
export function loadState(dir:string,p:Project):State { const base=projectDir(dir,p.id); mkdirSync(base,{recursive:true,mode:0o700}); for(const d of ['artifacts','logs']) mkdirSync(join(base,d),{mode:0o700,recursive:true}); const path=join(base,'state.json'); const state:State=existsSync(path)?readJSON(path):{artifacts:[],deployments:[]}; if(!Array.isArray(state.artifacts)||!Array.isArray(state.deployments)||state.artifacts.length>100||state.deployments.length>100||state.artifacts.some(a=>!validId(a.id)||typeof a.name!=='string'||!Number.isInteger(a.size)||a.size<0)||state.deployments.some(d=>!validId(d.id))) throw new Error('Invalid state'); for(const d of state.deployments) if(d.status==='running'){d.status='interrupted';d.finishedAt=new Date().toISOString();} atomicJSON(path,state); return state; }
export function saveState(dir:string,p:Project,s:State) {atomicJSON(join(projectDir(dir,p.id),'state.json'),s);}
export function cleanOrphans(dir:string,p:Project,s:State) {const base=projectDir(dir,p.id); for(const file of readdirSync(join(base,'artifacts'))) if(!s.artifacts.some(a=>file===a.id+'.bin')) unlinkSync(join(base,'artifacts',file)); for(const file of readdirSync(join(base,'logs'))) if(!s.deployments.some(d=>file===d.id+'.log')) unlinkSync(join(base,'logs',file));}

export function storedArtifactBytes(dir:string) {let size=0;const folders=readdirSync(join(dir,'projects'));if(folders.length>1024)throw new Error('Too many retained project directories; clean data offline');for(const folder of folders){if(!validId(folder))throw new Error('Unexpected project directory');const base=join(dir,'projects',folder);if(!lstatSync(base).isDirectory())throw new Error('Unexpected project directory');const artifacts=join(base,'artifacts');if(!existsSync(artifacts))continue;const files=readdirSync(artifacts);if(files.length>101)throw new Error('Too many retained artifacts');for(const file of files){const stat=lstatSync(join(artifacts,file));if(!stat.isFile())throw new Error('Unexpected artifact file');size+=stat.size;}}return size;}
