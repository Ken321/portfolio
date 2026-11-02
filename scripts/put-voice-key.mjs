import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../server/aws/package.json',import.meta.url));
const {SSMClient,PutParameterCommand}=require('@aws-sdk/client-ssm');
// Credentials and the API key remain in memory, never argv, temporary files or logs.
const key=process.env.OPENAI_API_KEY;
if(!key)throw Error('OPENAI_API_KEY is missing');
const profile=process.env.AWS_PROFILE||'default',region=process.env.AWS_REGION||'ap-northeast-1';
try {
 const auth=JSON.parse(execFileSync('aws',['configure','export-credentials','--format','process','--profile',profile,'--region',region],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 const client=new SSMClient({region,credentials:{accessKeyId:auth.AccessKeyId,secretAccessKey:auth.SecretAccessKey,sessionToken:auth.SessionToken}});
 await client.send(new PutParameterCommand({Name:'/321ken/voice/openai-api-key',Type:'SecureString',Tier:'Standard',Value:key,Overwrite:process.argv.includes('--overwrite')}));
 console.log('API key stored in Parameter Store.');
} catch(e) {console.error(`Key upload failed (${e.name||'Error'}). Secret details suppressed.`);process.exitCode=1;}
