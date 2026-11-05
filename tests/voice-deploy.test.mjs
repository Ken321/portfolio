import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { target, validateTemplate, validateStack, updateParameters, validateChangeSet, validateUnchanged } from '../scripts/voice-deploy-plan.mjs';
const template = JSON.parse(readFileSync(new URL('../server/aws/template.json', import.meta.url)));
const stack = () => ({ StackId: target.stack, StackStatus: 'UPDATE_COMPLETE', LastUpdatedTime: 'unchanged', Parameters: [{ ParameterKey: 'CodeBucket', ParameterValue: target.bucket }, { ParameterKey: 'CodeKey', ParameterValue: 'voice/1234.zip' }, { ParameterKey: 'VoiceEnabled', ParameterValue: 'true' }, { ParameterKey: 'ApiKeyParameter', ParameterValue: '/synthetic/key' }] });
const changes = () => ({ StackId: target.stack, Status: 'CREATE_COMPLETE', ExecutionStatus: 'AVAILABLE', Changes: ['Api', 'Cleanup'].map(LogicalResourceId => ({ Type: 'Resource', ResourceChange: { LogicalResourceId, Action: 'Modify', ResourceType: 'AWS::Lambda::Function', Replacement: 'False', Scope: ['Properties'], Details: [{ Target: { Attribute: 'Properties', Name: 'Code', RequiresRecreation: 'Never' }, ChangeSource: 'ParameterReference', CausingEntity: 'CodeKey', Evaluation: 'Static' }] } })) });
test('production template confines CodeKey to the two Lambda code references', () => validateTemplate(template));
test('rejects indirect/new consumers of the artifact parameter', () => {
 for (const extra of [{ Ref: 'CodeKey' }, { 'Fn::Sub': '${CodeKey}' }]) {
  const t = structuredClone(template); t.Outputs.Unexpected = { Value: extra };
  assert.throws(() => validateTemplate(t));
 }
});
test('preserves every existing parameter except the artifact key', () => {
 const result = updateParameters(stack(), `voice/${'a'.repeat(64)}.zip`);
 assert.deepEqual(result.filter(p => p.ParameterKey !== 'CodeKey'), stack().Parameters.filter(p => p.ParameterKey !== 'CodeKey').map(p => ({ ParameterKey: p.ParameterKey, UsePreviousValue: true })));
 assert.equal(result.find(p => p.ParameterKey === 'CodeKey').ParameterValue, `voice/${'a'.repeat(64)}.zip`);
});
test('rejects foreign stack, bucket, service role and unfinished update', () => {
 for (const altered of [{ StackId: 'other' }, { RoleARN: 'new-role' }, { StackStatus: 'UPDATE_IN_PROGRESS' }, { Parameters: [] }]) assert.throws(() => validateStack({ ...stack(), ...altered }));
});
test('accepts only the reviewed two-function code change set', () => validateChangeSet(changes()));
test('rejects resource additions/removals, replacements, config changes and ambiguous evidence', () => {
 const mutations = [c => c.Changes.push(c.Changes[0]), c => c.Changes.pop(), c => c.Changes[0].ResourceChange.Replacement = 'Conditional', c => c.Changes[0].ResourceChange.Action = 'Add', c => c.Changes[0].ResourceChange.LogicalResourceId = 'ApiRole', c => c.Changes[0].ResourceChange.Details[0].Target.Name = 'Environment', c => c.Changes[0].ResourceChange.Details = [], c => c.Changes[0].ResourceChange.Details[0].Evaluation = 'Dynamic', c => c.RoleARN = 'role', c => c.StackId = 'other'];
 for (const mutate of mutations) { const c = changes(); mutate(c); assert.throws(() => validateChangeSet(c)); }
});
test('stops when another update changes parameters or stack timestamp', () => {
 validateUnchanged(stack(), stack());
 const after = stack(); after.Parameters[2].ParameterValue = 'false';
 assert.throws(() => validateUnchanged(stack(), after));
 assert.throws(() => validateUnchanged(stack(), { ...stack(), LastUpdatedTime: 'new' }));
});
test('CLI refuses default/read-only profiles before running any AWS operation', async () => {
 const { spawnSync } = await import('node:child_process');
 for (const profile of ['', 'default', 'portfolio-voice-read']) {
  const result = spawnSync(process.execPath, ['scripts/deploy-voice.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, AWS_PROFILE: profile, PATH: '' }, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /separately authorized portfolio-voice-update/);
  assert.doesNotMatch(result.stderr, /ENOENT/);
 }
});

test('accepts completed rollback as stable but rejects active or failed recovery', () => {
 validateStack({...stack(),StackStatus:'UPDATE_ROLLBACK_COMPLETE'});
 for(const StackStatus of ['UPDATE_ROLLBACK_IN_PROGRESS','UPDATE_ROLLBACK_FAILED','UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS']) assert.throws(()=>validateStack({...stack(),StackStatus}));
});
