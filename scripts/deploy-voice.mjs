import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { target, validateStack, validateTemplate, updateParameters, validateChangeSet, validateUnchanged } from './voice-deploy-plan.mjs';
const root = resolve(import.meta.dirname, '..');
const profile = process.env.AWS_PROFILE;
const region = process.env.AWS_REGION || target.region;
let operation = 'local validation';
function aws(args) {
 operation = args.slice(0, 2).join(' ');
 return JSON.parse(execFileSync('aws', [...args, '--profile', profile, '--region', region, '--no-cli-pager', '--output', 'json'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, AWS_MAX_ATTEMPTS: '1' } }) || '{}');
}
function stack() { return aws(['cloudformation', 'describe-stacks', '--stack-name', target.stack]).Stacks[0]; }
try {
 if (profile !== 'portfolio-voice-update' || region !== target.region) throw new Error('Use the separately authorized portfolio-voice-update SSO profile in Tokyo');
 const identity = aws(['sts', 'get-caller-identity']);
 if (identity.Account !== target.account || !identity.Arn.includes(':assumed-role/AWSReservedSSO_PortfolioVoiceUpdater_')) throw new Error('Unexpected deployment principal');
 const before = stack();
 const parameters = validateStack(before);
 const body = aws(['cloudformation', 'get-template', '--stack-name', target.stack, '--template-stage', 'Original']).TemplateBody;
 validateTemplate(typeof body === 'string' ? JSON.parse(body) : body);
 const archivePath = resolve(root, '.aws-build/voice.zip');
 const archive = readFileSync(archivePath);
 const digest = createHash('sha256').update(archive).digest('hex');
 const codeKey = `voice/${digest}.zip`;
 if (parameters.get('CodeKey') === codeKey) throw new Error('This archive is already selected; verify live configuration instead');
 const journal = resolve(root, `.aws-build/deploy-${digest}.json`);
 if (existsSync(journal)) throw new Error(`An earlier attempt exists at ${journal}; inspect its change set before retrying`);
 const name = `portfolio-voice-update-${digest.slice(0,20)}-${Date.now()}`;
 const record = { stack: target.stack, name, codeKey, digest, stage: 'upload-requested' };
 const save = () => writeFileSync(journal, JSON.stringify(record, null, 2));
 save();
 // No implicit retries, overwrites, bucket creation or bucket configuration changes.
 aws(['s3api', 'put-object', '--bucket', target.bucket, '--key', codeKey, '--body', archivePath, '--server-side-encryption', 'AES256', '--if-none-match', '*']);
 record.stage = 'change-set-requested'; save();
 aws(['cloudformation', 'create-change-set', '--stack-name', target.stack, '--change-set-name', name, '--change-set-type', 'UPDATE', '--use-previous-template', '--capabilities', 'CAPABILITY_IAM', '--parameters', JSON.stringify(updateParameters(before, codeKey))]);
 let changes;
 for (let attempt = 0; attempt < 60; attempt++) {
  changes = aws(['cloudformation', 'describe-change-set', '--stack-name', target.stack, '--change-set-name', name]);
  if (!['CREATE_PENDING', 'CREATE_IN_PROGRESS'].includes(changes.Status)) break;
  await setTimeout(2000);
 }
 validateChangeSet(changes);
 record.stage = 'reviewed'; save();
 console.log(`Reviewed UPDATE: Api/Cleanup code only, no replacement. Change set: ${name}`);
 if (process.argv.includes('--execute')) {
  validateUnchanged(before, stack());
  validateChangeSet(aws(['cloudformation', 'describe-change-set', '--stack-name', target.stack, '--change-set-name', name]));
  record.stage = 'execute-requested'; save();
  aws(['cloudformation', 'execute-change-set', '--stack-name', target.stack, '--change-set-name', name]);
  record.stage = 'execution-started'; save();
  console.log('Execution started. Verify UPDATE_COMPLETE, both function hashes, and production before publishing the site.');
 } else console.log('Not executed. Inspect the saved change set before any later execution.');
} catch (error) {
 // Do not print AWS response bodies, parameter values or credentials.
 console.error(error.stderr ? `${operation} failed; stopped without automatic retry or permission changes. Inspect the saved journal and current state safely.` : error.message);
 process.exitCode = 1;
}
