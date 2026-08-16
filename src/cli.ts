#!/usr/bin/env node
import { Command } from 'commander';
import { resolveConfig,resolveCredential,runtime } from './core.js';
import { manifest } from './manifest.js';
import type { Envelope } from './types.js';
const p=new Command(); p.name('tailsacle-cli').description('Safe, zero-config Tailscale deployment CLI').version('0.1.0');
function out<T>(command:string,value:T,warnings:string[]=[],sideEffects:string[]=[]){const e:Envelope<T>={ok:true,command,resolved:value,warnings,requiredPrivileges:[],sideEffects,retryable:false}; if(process.argv.includes('--json')) console.log(JSON.stringify(e,null,2)); else console.log(JSON.stringify(value,null,2));}
p.command('doctor').description('Resolve credentials, runtime and capabilities without side effects').option('--detect-credentials').option('--show-resolution').action(()=>{const c=resolveCredential(); const cfg=resolveConfig(); const warnings:string[]=[]; if(!c.found)warnings.push(c.error==='MULTIPLE_CREDENTIALS'?'CREDENTIAL_AMBIGUOUS: use --credential-env':'CREDENTIAL_NOT_FOUND: set TS_CLIENT_SECRET or a trust credential'); out('doctor',{credential:{found:c.found,source:c.source,masked:c.masked,candidates:c.candidates},runtime,config:cfg},warnings);});
for(const name of ['deploy','up','funnel','serve','dns','policy','status','cleanup']) p.command(name).option('--dry-run').option('--yes').option('--json').action(()=>{const cfg=resolveConfig(); const warnings=name==='funnel'?['EXPOSE_AUTO_DETECT: configure --expose or PORT before enabling Funnel']:[]; const effects=name==='policy'?['policy write requires diff, backup, validate, ETag and confirmation']:name==='cleanup'?['device deletion requires candidate list and confirmation']:[]; out(name,cfg,warnings,effects);});
p.command('agent-manifest').description('Print the machine-readable agent contract').action(()=>console.log(JSON.stringify(manifest,null,2)));
p.option('--update-bin').option('--json'); p.action(()=>{if(process.argv.length<=2) p.help();});
p.parseAsync().catch((err:unknown)=>{console.error(err instanceof Error?err.message:String(err));process.exitCode=1;});
