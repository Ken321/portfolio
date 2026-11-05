import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAwsFailure as summarize } from '../scripts/voice-deploy-diagnostics.mjs';
const run = stderr => summarize({ stderr, status: 254, operation: 'cloudformation describe-change-set' });
test('standard AWS error', () => {
 const x = run('An error occurred (AccessDenied) when calling the DescribeChangeSet operation: Not authorized');
 assert.equal(x.errorCode, 'AccessDenied'); assert.equal(x.reason, 'Not authorized');
});
test('multiline, missing post-colon space and ANSI output', () => {
 const x = run('\x1b[31mAn error occurred (ValidationError) when calling the DescribeChangeSet operation:\nStack does not exist\x1b[0m');
 assert.equal(x.errorCode, 'ValidationError'); assert.equal(x.reason, 'Stack does not exist');
});
test('structured JSON and request ID', () => {
 const x = run(JSON.stringify({ Error: { Code: 'AccessDeniedException', Message: 'Denied' }, ResponseMetadata: { RequestId: 'synthetic-request-id' } }));
 assert.equal(x.errorCode, 'AccessDeniedException'); assert.equal(x.reason, 'Denied'); assert.equal(x.requestId, 'synthetic-request-id');
});
test('nonstandard format retains redacted fallback', () => {
 const x = run('AWS operation failed\nCould not connect to endpoint URL: https://example.test/?secret=hidden');
 assert.equal(x.errorCode, null); assert.match(x.reason, /Could not connect/); assert.doesNotMatch(x.reason, /hidden|https/);
 assert.equal(x.classification, 'UNCLASSIFIED_REDACTED_STDERR');
});
test('redacts synthetic credentials and private identifiers', () => {
 const x = run('An error occurred (AccessDenied) when calling the DescribeChangeSet operation: arn:aws:iam::123456789012:role/Synthetic api_key="synthetic-key" authorization=Bearer abc123 user@example.test https://example.test/token?x=private sk-synthetic123');
 assert.doesNotMatch(x.reason, /synthetic-key|abc123|user@example|https|sk-synthetic/);
});
test('Buffer, empty and localized format remain diagnosable', () => {
 assert.match(run(Buffer.from('接続エラー: SSL validation failed')).reason, /SSL validation failed/);
 assert.equal(run('').reason, 'No stderr was returned');
 assert.equal(run('Error code: ExpiredToken\nSession expired').errorCode, 'ExpiredToken');
});
test('bounded output preserves fingerprint and truncation status', () => {
 const x = run('x'.repeat(2500)); assert.equal(x.reason.length, 2000); assert.equal(x.reasonTruncated, true); assert.equal(x.stderrBytes, 2500); assert.equal(x.stderrSha256.length, 64);
});
test('saves a safe failure before the process exits, refuses overwriting evidence', async () => {
 const { saveFailure } = await import('../scripts/voice-deploy-diagnostics.mjs');
 const { mkdtemp, readFile, stat, rm } = await import('node:fs/promises');
 const { tmpdir } = await import('node:os');
 const { join } = await import('node:path');
 const dir = await mkdtemp(join(tmpdir(), 'portfolio-error-test-'));
 try {
  const path = join(dir, 'diagnostic.json');
  const error = { status: 254, stderr: Buffer.from('Unrecognized failure api_key="synthetic-secret"') };
  await saveFailure(error, 'cloudformation describe-change-set', path);
  const data = await readFile(path, 'utf8');
  assert.match(data, /Unrecognized failure/); assert.doesNotMatch(data, /synthetic-secret/);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await assert.rejects(saveFailure(error, 'cloudformation describe-change-set', path), { code: 'EEXIST' });
 } finally { await rm(dir, { recursive: true }); }
});

test('AWS retry-count suffix is parsed without losing the actual reason', () => {
 const x = run('An error occurred (AccessDenied) when calling the DescribeChangeSet operation (reached max retries: 0): Denied by identity policy');
 assert.equal(x.errorCode, 'AccessDenied'); assert.equal(x.reason, 'Denied by identity policy');
});
test('context evidence retains nonsecret structure and fingerprints secret values', async () => {
 const { safeChangeSetEvidence } = await import('../scripts/voice-deploy-diagnostics.mjs');
 const context={Properties:{Code:{S3Key:'voice/synthetic.zip'},Environment:{Variables:{ODD_NAME:'synthetic-hidden-value',OPENAI_REALTIME_VOICE:'echo'}},Endpoint:'test@example.test'}};
 const result=safeChangeSetEvidence({Changes:[{Type:'Resource',ResourceChange:{BeforeContext:JSON.stringify(context),AfterContext:JSON.stringify(context),Details:[{Target:{Path:'/Properties/Environment/Variables/ODD_NAME',BeforeValue:'synthetic-hidden-value',AfterValue:'synthetic-new-secret'}}]}}]});
 const text=JSON.stringify(result);
 assert.doesNotMatch(text,/synthetic-hidden-value|synthetic-new-secret|test@example/);
 const c=result.Changes[0].ResourceChange;
 assert.equal(c.BeforeContext.present,true);assert.equal(c.AfterContext.present,true);
 assert.equal(c.BeforeContext.value.Properties.Code.S3Key,'voice/synthetic.zip');
 assert.equal(c.BeforeContext.value.Properties.Environment.Variables.ODD_NAME.redacted,true);
 assert.equal(c.BeforeContext.sha256,c.AfterContext.sha256);
});
test('missing and malformed contexts remain explicitly distinguishable', async () => {
 const { safeChangeSetEvidence }=await import('../scripts/voice-deploy-diagnostics.mjs');
 const x=safeChangeSetEvidence({Changes:[{ResourceChange:{AfterContext:'broken json'}}]});
 assert.equal(x.Changes[0].ResourceChange.BeforeContext.present,false);
 assert.equal(x.Changes[0].ResourceChange.AfterContext.parseable,false);
});
test('authorization target ARN is retained while credentials remain redacted',()=>{
 const arn='arn:aws:cloudformation:ap-northeast-1:123456789012:stack/synthetic/id';
 const x=run(`An error occurred (AccessDenied) when calling the DescribeChangeSet operation (reached max retries: 0): denied on resource ${arn}`);
 assert.ok(x.reason.includes(arn));
});
