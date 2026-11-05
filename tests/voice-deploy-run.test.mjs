import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,statSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDeployment } from '../scripts/voice-deploy-run.mjs';
import { target } from '../scripts/voice-deploy-plan.mjs';
const template=JSON.parse(readFileSync(new URL('../server/aws/template.json',import.meta.url)));
function fixture(t, options={}){
 const root=mkdtempSync(join(tmpdir(),'portfolio-deploy-offline-'));mkdirSync(join(root,'.aws-build'));writeFileSync(join(root,'.aws-build/voice.zip'),'synthetic archive');t.after(()=>rmSync(root,{recursive:true,force:true}));
 const calls=[];let newKey,name;
 const before={StackId:target.stack,StackStatus:'UPDATE_COMPLETE',LastUpdatedTime:'old',Parameters:[{ParameterKey:'CodeBucket',ParameterValue:target.bucket},{ParameterKey:'CodeKey',ParameterValue:'voice/1234.zip'},{ParameterKey:'VoiceEnabled',ParameterValue:'true'}]};
 function changeSet(){return {ChangeSetName:name,Parameters:before.Parameters.map(p=>({...p,ParameterValue:p.ParameterKey === 'CodeKey' ? newKey : p.ParameterValue})),StackId:target.stack,ChangeSetId:`arn:aws:cloudformation:${target.region}:${target.account}:changeSet/${name}/synthetic-id`,Status:'CREATE_COMPLETE',ExecutionStatus:'AVAILABLE',Changes:['Api','Cleanup'].map(id=>{
  function resolve(v){if(Array.isArray(v))return v.map(resolve);if(v&&typeof v==='object'){if(v.Ref)return v.Ref==='CodeBucket'?target.bucket:v.Ref==='CodeKey'?'voice/1234.zip':'synthetic-secret';if(v['Fn::Sub']?.startsWith('${AWS::StackName}-'))return v['Fn::Sub'].replace('${AWS::StackName}','portfolio-voice');if(Object.keys(v).some(k=>k.startsWith('Fn::')))return 'synthetic-resolved';return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,resolve(x)]));}return v;}
  const context={Properties:resolve(template.Resources[id].Properties)};
  const after=structuredClone(context);after.Properties.Code.S3Key=newKey;
  return {Type:'Resource',ResourceChange:{Action:'Modify',LogicalResourceId:id,PhysicalResourceId:context.Properties.FunctionName,ResourceType:'AWS::Lambda::Function',Replacement:'False',Scope:['Properties'],BeforeContext:JSON.stringify(context),AfterContext:JSON.stringify(after),Details:[{Target:{Attribute:'Properties',Name:'Code',RequiresRecreation:'Never',Path:'/Properties/Code/S3Key',BeforeValue:'voice/1234.zip',AfterValue:newKey,AttributeChangeType:'Modify'},ChangeSource:'ParameterReference',CausingEntity:'CodeKey',Evaluation:'Static'}]}};})};}
 const aws=args=>{
  const op=args.slice(0,2).join(' ');calls.push({op,args});
  if(options.fail===op){const e=new Error('untrusted full command');e.status=254;e.stderr=Buffer.from('An error occurred (AccessDenied) when calling the DescribeChangeSet operation (reached max retries: 0): Denied api_key="synthetic-key"');throw e;}
  if(op==='sts get-caller-identity')return {Account:target.account,Arn:`arn:aws:sts::${target.account}:assumed-role/AWSReservedSSO_PortfolioVoiceUpdater_mock/user`};
  if(op==='cloudformation describe-stacks')return {Stacks:[structuredClone(before)]};
  if(op==='cloudformation get-template')return {TemplateBody:template};
  if(op==='s3api put-object'){newKey=args[args.indexOf('--key')+1];return {};}
  if(op==='cloudformation create-change-set'){name=args[args.indexOf('--change-set-name')+1];return {Id:changeSet().ChangeSetId,StackId:target.stack};}
  if(op==='cloudformation describe-change-set'){const x=changeSet();options.mutate?.(x);return x;}
  if(op==='cloudformation execute-change-set')return {};
  throw new Error('Unexpected mock operation');
 };
 const run=execute=>runDeployment({root,profile:'portfolio-voice-update',region:target.region,execute,aws,wait:async()=>{},now:()=>123});
 const journal=()=>JSON.parse(readFileSync(join(root,'.aws-build',readdirSync(join(root,'.aws-build')).find(n=>n.startsWith('deploy-')))));
 return {run,calls,journal,root};
}
test('offline prepare retains IDs/contexts in private journal and never executes',async t=>{
 const f=fixture(t);const r=await f.run(false);assert.equal(r.stage,'reviewed');assert.equal(f.calls.some(c=>c.op==='cloudformation execute-change-set'),false);
 const j=f.journal();assert.match(j.changeSetId,/synthetic-id/);assert.equal(j.inspection.Changes[0].ResourceChange.BeforeContext.present,true);
 assert.doesNotMatch(JSON.stringify(j),/synthetic-secret/);assert.equal(statSync(r.journal).mode&0o777,0o600);
 const create=f.calls.find(c=>c.op==='cloudformation create-change-set');assert.ok(create.args.includes('--use-previous-template'));assert.equal(create.args.includes('--role-arn'),false);
});
test('execute occurs once only after reinspection and validation',async t=>{
 const f=fixture(t);assert.equal((await f.run(true)).stage,'execution-started');assert.equal(f.calls.filter(c=>c.op==='cloudformation execute-change-set').length,1);
 assert.equal(f.calls.filter(c=>c.op==='cloudformation describe-change-set').length,2);
});
test('captured denial retains created ID and stops, without retry or secret output',async t=>{
 const f=fixture(t,{fail:'cloudformation describe-change-set'});await assert.rejects(f.run(true),/stopped/);
 const j=f.journal();assert.equal(j.stage,'stopped');assert.equal(j.failedAtStage,'change-set-created');assert.match(j.changeSetId,/synthetic-id/);
 assert.equal(j.failure.errorCode,'AccessDenied');assert.doesNotMatch(JSON.stringify(j),/synthetic-key/);
 assert.equal(f.calls.filter(c=>c.op==='cloudformation describe-change-set').length,1);assert.equal(f.calls.some(c=>c.op==='cloudformation execute-change-set'),false);
});
test('uncertain create result is journaled and prevents blind duplicate creation',async t=>{
 const f=fixture(t,{fail:'cloudformation create-change-set'});await assert.rejects(f.run(true));assert.equal(f.journal().failedAtStage,'change-set-requested');
 const count=f.calls.length;await assert.rejects(f.run(true),/earlier attempt/);assert.equal(f.calls.length,count);
});
test('warnings stop even when the two listed changes appear valid',async t=>{
 const f=fixture(t,{mutate:x=>x.StatusReason='[WARN] incomplete preview'});await assert.rejects(f.run(true),/stopped/);
 assert.equal(f.journal().inspection.StatusReason,'[WARN] incomplete preview');assert.equal(f.calls.some(c=>c.op==='cloudformation execute-change-set'),false);
});
test('unexpected resource, page token, missing context, or hidden configuration change all stop',async t=>{
 const mutations=[x=>x.Changes.push(x.Changes[0]),x=>x.NextToken='another-page',x=>delete x.Changes[0].ResourceChange.BeforeContext,x=>{const r=x.Changes[0].ResourceChange;const a=JSON.parse(r.AfterContext);a.Properties.Environment.Variables.DO_NOT_LOG='changed';r.AfterContext=JSON.stringify(a);}];
 for(const mutate of mutations){const f=fixture(t,{mutate});await assert.rejects(f.run(true),/stopped/);assert.equal(f.calls.some(c=>c.op==='cloudformation execute-change-set'),false);}
});
test('pending attempts cannot upload/execute again after local validation failure',async t=>{
 const f=fixture(t,{mutate:x=>x.StatusReason='incomplete'});await assert.rejects(f.run(false));const n=f.calls.length;await assert.rejects(f.run(false),/earlier attempt/);assert.equal(f.calls.length,n);
});
test('uncertain execute outcome is preserved and never automatically retried',async t=>{
 const f=fixture(t,{fail:'cloudformation execute-change-set'});await assert.rejects(f.run(true));
 assert.equal(f.journal().failedAtStage,'execute-requested');assert.match(f.journal().changeSetId,/synthetic-id/);
 assert.equal(f.calls.filter(c=>c.op==='cloudformation execute-change-set').length,1);
 const n=f.calls.length;await assert.rejects(f.run(true),/earlier attempt/);assert.equal(f.calls.length,n);
});

function pairedParameterDetails(x) {
 for (const {ResourceChange:r} of x.Changes) r.Details.push({Target:structuredClone(r.Details[0].Target),Evaluation:'Dynamic',ChangeSource:'DirectModification'});
}
test('documented paired Static/Dynamic Ref change passes complete bound offline review',async t=>{
 const f=fixture(t,{mutate:pairedParameterDetails});assert.equal((await f.run(false)).stage,'reviewed');assert.equal(f.calls.some(c=>c.op==='cloudformation execute-change-set'),false);
});
const unsafePairs={
 'dynamic without static':x=>x.Changes[0].ResourceChange.Details.shift(),
 'different dynamic path':x=>x.Changes[0].ResourceChange.Details[1].Target.Path='/Properties/Environment',
 'different dynamic value':x=>x.Changes[0].ResourceChange.Details[1].Target.AfterValue='voice/other.zip',
 'different causing parameter':x=>x.Changes[0].ResourceChange.Details[0].CausingEntity='VoiceEnabled',
 'extra detail':x=>x.Changes[0].ResourceChange.Details.push(structuredClone(x.Changes[0].ResourceChange.Details[0])),
 'warning':x=>x.StatusReason='[WARN] incomplete',
 'page':x=>x.NextToken='more',
 'different change set ID':x=>x.ChangeSetId+='-different',
 'different change set name':x=>x.ChangeSetName+='-different',
 'different stack':x=>x.StackId+='-different',
 'different ZIP parameter':x=>x.Parameters.find(p=>p.ParameterKey==='CodeKey').ParameterValue='voice/'+'b'.repeat(64)+'.zip',
 'different other parameter':x=>x.Parameters.find(p=>p.ParameterKey==='VoiceEnabled').ParameterValue='false',
 'missing parameter':x=>x.Parameters.pop(),
 'different function':x=>x.Changes[0].ResourceChange.PhysicalResourceId='other',
 'different logical resource':x=>x.Changes[0].ResourceChange.LogicalResourceId='ApiRole',
 'replacement':x=>x.Changes[0].ResourceChange.Replacement='True',
 'missing context':x=>delete x.Changes[0].ResourceChange.BeforeContext,
 'partial contexts':x=>{for(const k of ['BeforeContext','AfterContext']){const r=x.Changes[0].ResourceChange,v=JSON.parse(r[k]);delete v.Properties.Role;r[k]=JSON.stringify(v);}},
 'unresolved contexts':x=>{for(const k of ['BeforeContext','AfterContext']){const r=x.Changes[0].ResourceChange,v=JSON.parse(r[k]);v.Properties.Role='KNOWN_AFTER_APPLY';r[k]=JSON.stringify(v);}},
 'redacted contexts':x=>{for(const k of ['BeforeContext','AfterContext']){const r=x.Changes[0].ResourceChange,v=JSON.parse(r[k]);v.Properties.Role={redacted:true,sha256:'same'};r[k]=JSON.stringify(v);}},
 'code outside selected ZIP':x=>{const r=x.Changes[0].ResourceChange,v=JSON.parse(r.AfterContext);v.Properties.Code.S3Key='voice/'+'c'.repeat(64)+'.zip';r.AfterContext=JSON.stringify(v);},
 'hidden config difference':x=>{const r=x.Changes[0].ResourceChange,v=JSON.parse(r.AfterContext);v.Properties.Timeout=90;r.AfterContext=JSON.stringify(v);}
};
for(const [label,mutate] of Object.entries(unsafePairs)) test(`paired detail rejects ${label} without executing`,async t=>{
 const f=fixture(t,{mutate:x=>{pairedParameterDetails(x);mutate(x);}});await assert.rejects(f.run(true));assert.equal(f.calls.some(c=>c.op==='cloudformation execute-change-set'),false);
});
