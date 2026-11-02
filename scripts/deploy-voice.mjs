import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const profile=process.env.AWS_PROFILE||'default',region=process.env.AWS_REGION||'ap-northeast-1';
const stack='portfolio-voice';
function aws(args,input){return execFileSync('aws',[...args,'--profile',profile,'--region',region,'--no-cli-pager'],{encoding:'utf8',input,stdio:['pipe','pipe','pipe']});}
try {
 const identity=JSON.parse(aws(['sts','get-caller-identity','--output','json']));
 console.log(`Target: ${identity.Account}, ${region}, ${stack}`);
 const archive=readFileSync(resolve(root,'.aws-build/voice.zip'));
 const digest=createHash('sha256').update(archive).digest('hex').slice(0,20);
 const bucket=`portfolio-voice-artifacts-${identity.Account}-${region}`;
 // Only create a new dedicated bucket if this exact bucket is absent.
 let exists=false;
 try{aws(['s3api','head-bucket','--bucket',bucket]);exists=true;}catch(e){if(!String(e.stderr).includes('404'))throw e;}
 if(!exists)aws(['s3api','create-bucket','--bucket',bucket,...(region==='us-east-1'?[]:['--create-bucket-configuration',`LocationConstraint=${region}`])]);
 aws(['s3api','put-public-access-block','--bucket',bucket,'--public-access-block-configuration','BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true']);
 aws(['s3api','put-bucket-encryption','--bucket',bucket,'--server-side-encryption-configuration',JSON.stringify({Rules:[{ApplyServerSideEncryptionByDefault:{SSEAlgorithm:'AES256'}}]})]);
 const codeKey=`voice/${digest}.zip`;
 aws(['s3','cp',resolve(root,'.aws-build/voice.zip'),`s3://${bucket}/${codeKey}`,'--only-show-errors']);
 const enabled=process.env.VOICE_ENABLED||'false';
 const origins=process.env.VOICE_ALLOWED_ORIGINS||'https://321ken.com';
 const params=[`CodeBucket=${bucket}`,`CodeKey=${codeKey}`,`VoiceEnabled=${enabled}`,`AllowedOrigins=${origins}`];
 if(process.env.AWS_NOTIFICATION_EMAIL)params.push(`NotificationEmail=${process.env.AWS_NOTIFICATION_EMAIL}`);
 const args=['cloudformation','deploy','--stack-name',stack,'--template-file',resolve(root,'server/aws/template.json'),'--capabilities','CAPABILITY_IAM','--parameter-overrides',...params,'--no-fail-on-empty-changeset'];
 if(!process.argv.includes('--execute'))args.push('--no-execute-changeset');
 console.log(aws(args));
 if(process.argv.includes('--execute'))console.log(aws(['cloudformation','describe-stacks','--stack-name',stack,'--query','Stacks[0].Outputs','--output','json']));
} catch(e) {console.error(String(e.stderr||e.message));process.exitCode=1;}
