import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { initData, atomicJSON, validId } from './store';
import { startServer } from './server';
const HELP=`Hoist (Bun, Linux)
  bun src/main.ts init --data-dir /absolute/install-dir
  bun src/main.ts user set USER --password-stdin --data-dir DIR
  bun src/main.ts user list --data-dir DIR
  bun src/main.ts user remove USER --data-dir DIR
  bun src/main.ts project set ID --name NAME --script /absolute/trusted.sh --timeout 300 --data-dir DIR
  bun src/main.ts project list --data-dir DIR
  bun src/main.ts project remove ID --data-dir DIR
  bun src/main.ts serve --data-dir DIR
The data directory contains config.json, accounts, artifacts and bounded deployment logs.
Stop the server before changing accounts, projects or config. Supply passwords over stdin, never argv.
`;
export async function main(argv:string[]){
 if(!argv.length||argv.includes('--help')){console.log(HELP);return;}
 const positional:string[]=[];const options=new Map<string,string>();for(let i=0;i<argv.length;i++){if(argv[i].startsWith('--')){if(argv[i]==='--password-stdin'){options.set(argv[i],'true');continue;}if(!['--data-dir','--name','--script','--timeout'].includes(argv[i])||!argv[i+1]||argv[i+1].startsWith('--'))throw new Error('Unknown/incomplete option');options.set(argv[i],argv[++i]);}else positional.push(argv[i]);}
 const data=options.get('--data-dir')||process.env.HOIST_DATA_DIR;if(!data)throw new Error('--data-dir is required');const {dir,configPath,config}=initData(data);const lock=join(dir,'runtime.lock');
 function acquire(){try{mkdirSync(lock,{mode:0o700});}catch{if(!existsSync(join(lock,'pid')))throw new Error('Data directory locked; inspect runtime.lock if previous process crashed');const pid=Number(readFileSync(join(lock,'pid'),'utf8'));let live=true;try{process.kill(pid,0);}catch(e:any){if(e.code==='ESRCH')live=false;}if(live)throw new Error('Stop the running server before making changes');rmSync(lock,{recursive:true});mkdirSync(lock,{mode:0o700});}writeFileSync(join(lock,'pid'),String(process.pid),{mode:0o600});}
 const command=positional[0];if(command==='serve'){
  acquire();let runtime:ReturnType<typeof startServer>;try{runtime=startServer(dir,config);}catch(e){rmSync(lock,{recursive:true});throw e;}
  let exiting=false;const shutdown=async()=>{if(exiting)return;exiting=true;await runtime.stop();rmSync(lock,{recursive:true});process.exit(0);};process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);return;
 }
 acquire();try{
  if(command==='init'){console.log(`Configuration ready: ${configPath}`);return;}
  if(command==='user'){
   const action=positional[1],username=positional[2];if(action==='list'){console.log(config.accounts.map(a=>a.username).join('\n')||'(no accounts)');return;}if(!username||!validId(username))throw new Error('Invalid username');
   if(action==='set'){if(!options.has('--password-stdin'))throw new Error('--password-stdin is required');let password=(await Bun.stdin.text()).replace(/\r?\n$/,'');if(password.length<12||Buffer.byteLength(password,'utf8')>72||/[\x00-\x1f\x7f]/.test(password))throw new Error('Password must be at least 12 characters, at most 72 UTF-8 bytes, without control characters');const passwordHash=await Bun.password.hash(password,{algorithm:'bcrypt',cost:12});password='';const old=config.accounts.find(a=>a.username===username);if(old)old.passwordHash=passwordHash;else{if(config.accounts.length>=32)throw new Error('Account limit reached');config.accounts.push({username,passwordHash});}atomicJSON(configPath,config);console.log(`Account saved: ${username}`);return;}
   if(action==='remove'){config.accounts=config.accounts.filter(a=>a.username!==username);atomicJSON(configPath,config);console.log(`Account removed: ${username}`);return;}
  }
  if(command==='project'){
   const action=positional[1],id=positional[2];if(action==='list'){for(const p of config.projects)console.log(`${p.id}\t${p.name}\t${p.script}`);return;}if(!id||!validId(id))throw new Error('Invalid project ID');
   if(action==='set'){const input=options.get('--script');if(!input||!input.startsWith('/')||!existsSync(input)||!lstatSync(input).isFile())throw new Error('--script must name an existing absolute trusted script');const script=realpathSync(input);if(script.startsWith(join(dir,'projects')+'/')||script.startsWith(resolve(import.meta.dir,'../public')+'/'))throw new Error('Uploaded artifacts/web assets cannot be registered as scripts');const name=options.get('--name')||id;const timeoutSeconds=Number(options.get('--timeout')||300);if(name.length>100||!Number.isInteger(timeoutSeconds)||timeoutSeconds<1||timeoutSeconds>3600)throw new Error('Invalid name/timeout');const project={id,name,script,timeoutSeconds};const index=config.projects.findIndex(p=>p.id===id);if(index>=0)config.projects[index]=project;else{if(config.projects.length>=32)throw new Error('Project limit reached');config.projects.push(project);}atomicJSON(configPath,config);console.log(`Project saved: ${id}`);return;}
   if(action==='remove'){config.projects=config.projects.filter(p=>p.id!==id);atomicJSON(configPath,config);console.log(`Project unregistered: ${id} (data retained)`);return;}
  }
  throw new Error('Unknown command. Use --help');
 }finally{rmSync(lock,{recursive:true});}
}
if(import.meta.main)main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
