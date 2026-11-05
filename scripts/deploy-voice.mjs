import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { target } from './voice-deploy-plan.mjs';
import { runDeployment } from './voice-deploy-run.mjs';
const root=resolve(import.meta.dirname,'..');
const profile=process.env.AWS_PROFILE;
const region=process.env.AWS_REGION||target.region;
function aws(args) {
 const output=execFileSync('aws',[...args,'--profile',profile,'--region',region,'--no-cli-pager','--output','json'],{encoding:'utf8',stdio:['pipe','pipe','pipe'],env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_CLI_AUTO_PROMPT:'off'}});
 try{return JSON.parse(output||'{}');}catch{throw new Error('AWS CLI returned invalid JSON');}
}
try {
 const result=await runDeployment({root,profile,region,execute:process.argv.includes('--execute'),aws,wait:setTimeout});
 console.log(JSON.stringify(result));
 console.log(result.stage==='execution-started'?'Execution started; verify UPDATE_COMPLETE and production before publishing the site.':'Reviewed only; no change set was executed.');
} catch(error) {
 console.error(error.message);
 if(error.diagnostic)console.error(JSON.stringify({operation:error.diagnostic.operation,errorCode:error.diagnostic.errorCode,exitCode:error.diagnostic.exitCode}));
 process.exitCode=1;
}
