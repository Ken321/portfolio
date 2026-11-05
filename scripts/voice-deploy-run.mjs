import { readFileSync, openSync, writeSync, ftruncateSync, fsyncSync, closeSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { target, validateStack, validateTemplate, updateParameters, validateChangeSet, validateUnchanged } from './voice-deploy-plan.mjs';
import { summarizeAwsFailure, safeChangeSetEvidence } from './voice-deploy-diagnostics.mjs';

// All AWS effects are injected so end-to-end failure paths can be tested offline.
export async function runDeployment({ root, profile, region, execute, aws, wait, now = Date.now }) {
 if (profile !== 'portfolio-voice-update' || region !== target.region) throw new Error('Use the separately authorized portfolio-voice-update SSO profile in Tokyo');
 const archivePath = resolve(root, '.aws-build/voice.zip');
 const digest = createHash('sha256').update(readFileSync(archivePath)).digest('hex');
 const codeKey = `voice/${digest}.zip`;
 const journal = resolve(root, `.aws-build/deploy-${digest}.json`);
 if (existsSync(journal)) throw new Error(`An earlier attempt exists at ${journal}; inspect its recorded state before retrying`);
 const fd = openSync(journal, 'wx', 0o600);
 const record = { stage: 'preflight', stack: target.stack, name: `portfolio-voice-update-${digest.slice(0,20)}-${now()}`, codeKey, digest };
 let operation = 'local validation';
 const save = () => { const bytes = Buffer.from(JSON.stringify(record,null,2)); ftruncateSync(fd,0); writeSync(fd,bytes,0,bytes.length,0); fsyncSync(fd); };
 const call = args => { operation = args.slice(0,2).join(' '); record.lastOperation = operation; save(); return aws(args); };
 const stack = () => call(['cloudformation','describe-stacks','--stack-name',target.stack]).Stacks[0];
 save();
 try {
  const identity = call(['sts','get-caller-identity']);
  if (identity.Account !== target.account || !identity.Arn.includes(':assumed-role/AWSReservedSSO_PortfolioVoiceUpdater_')) throw new Error('Unexpected deployment principal');
  const before = stack(); const parameters = validateStack(before);
  if (parameters.get('CodeKey') === codeKey) throw new Error('This archive is already selected; verify live configuration instead');
  const body = call(['cloudformation','get-template','--stack-name',target.stack,'--template-stage','Original']).TemplateBody;
  const template = typeof body === 'string' ? JSON.parse(body) : body;
  validateTemplate(template);
  record.stage = 'upload-requested'; save();
  call(['s3api','put-object','--bucket',target.bucket,'--key',codeKey,'--body',archivePath,'--server-side-encryption','AES256','--if-none-match','*']);
  record.stage = 'change-set-requested'; save();
  const created = call(['cloudformation','create-change-set','--stack-name',target.stack,'--change-set-name',record.name,'--change-set-type','UPDATE','--use-previous-template','--capabilities','CAPABILITY_IAM','--parameters',JSON.stringify(updateParameters(before,codeKey))]);
  // Save returned IDs before any validation/read operation can fail.
  record.changeSetId = created.Id; record.createdStackId = created.StackId; record.stage = 'change-set-created'; save();
  if (created.StackId !== target.stack || !created.Id?.startsWith(`arn:aws:cloudformation:${region}:${target.account}:changeSet/${record.name}/`)) throw new Error('Unexpected created change set identity');
  const inspect = () => {
   const x = call(['cloudformation','describe-change-set','--stack-name',target.stack,'--change-set-name',record.name,'--include-property-values','--no-paginate']);
   record.inspection = safeChangeSetEvidence(x); save();
   return x;
  };
  let changes;
  for (let attempt = 0; attempt < 60; attempt++) {
   changes = inspect();
   if (!['CREATE_PENDING','CREATE_IN_PROGRESS'].includes(changes.Status)) break;
   await wait(2000);
  }
  const review = {changeSetId:record.changeSetId,name:record.name,oldKey:parameters.get('CodeKey'),newKey:codeKey,parameters,template};
  operation = 'change set validation';
  validateChangeSet(changes,review);
  record.stage = 'reviewed'; save();
  if (execute) {
   validateUnchanged(before,stack());
   const latest = inspect(); operation = 'change set validation';
   validateChangeSet(latest,review);
   if (latest.ChangeSetId !== record.changeSetId) throw new Error('Change set identity changed');
   record.stage = 'execute-requested'; save();
   call(['cloudformation','execute-change-set','--stack-name',target.stack,'--change-set-name',record.name]);
   record.stage = 'execution-started'; save();
  }
  return { stage: record.stage, name: record.name, changeSetId: record.changeSetId, journal };
 } catch (error) {
  record.failure = error.stderr !== undefined || error.status !== undefined
   ? summarizeAwsFailure({ stderr: error.stderr || error.stdout || error.message || '', status: error.status ?? null, operation })
   : { operation, classification: 'LOCAL_VALIDATION', reason: error.message };
  record.failedAtStage = record.stage; record.stage = 'stopped'; save();
  const failure = new Error(`${operation} failed; stopped. Diagnostic journal: ${journal}`);
  failure.diagnostic = record.failure; throw failure;
 } finally { closeSync(fd); }
}
