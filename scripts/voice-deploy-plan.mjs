import { isDeepStrictEqual } from 'node:util';
export const target = Object.freeze({
 account: '049570618333', region: 'ap-northeast-1',
 stack: 'arn:aws:cloudformation:ap-northeast-1:049570618333:stack/portfolio-voice/03e00d70-d657-11f1-8e25-0effcd4b1867',
 bucket: 'portfolio-voice-artifacts-049570618333-ap-northeast-1',
});
function requireThat(ok, message) { if (!ok) throw new Error(message); }
export function validateStack(stack) {
 requireThat(stack.StackId === target.stack && !stack.RoleARN, 'Unexpected stack or service role');
 requireThat(['UPDATE_COMPLETE', 'CREATE_COMPLETE'].includes(stack.StackStatus), 'Stack is not ready');
 const params = new Map(stack.Parameters.map(p => [p.ParameterKey, p.ParameterValue]));
 requireThat(params.get('CodeBucket') === target.bucket && /^voice\/[a-f0-9]+\.zip$/.test(params.get('CodeKey')), 'Unexpected artifact location');
 return params;
}
export function validateTemplate(template) {
 const expected = { S3Bucket: { Ref: 'CodeBucket' }, S3Key: { Ref: 'CodeKey' } };
 for (const id of ['Api', 'Cleanup']) {
  requireThat(template.Resources[id]?.Type === 'AWS::Lambda::Function' && isDeepStrictEqual(template.Resources[id].Properties.Code, expected), 'Unexpected Lambda code reference');
 }
 const paths = [];
 function visit(value, path) {
  if (typeof value === 'string') requireThat(!value.includes('${CodeKey}'), 'Indirect CodeKey reference');
  if (!value || typeof value !== 'object') return;
  if (value.Ref === 'CodeKey') paths.push(path.join('.'));
  for (const [key, child] of Object.entries(value)) visit(child, [...path, key]);
 }
 visit(template, []);
 requireThat(isDeepStrictEqual(paths.sort(), ['Resources.Api.Properties.Code.S3Key', 'Resources.Cleanup.Properties.Code.S3Key']), 'CodeKey affects resources outside the two code properties');
}
export function updateParameters(stack, codeKey) {
 validateStack(stack);
 requireThat(/^voice\/[a-f0-9]{64}\.zip$/.test(codeKey), 'Unexpected new artifact key');
 return stack.Parameters.map(p => p.ParameterKey === 'CodeKey' ? { ParameterKey: p.ParameterKey, ParameterValue: codeKey } : { ParameterKey: p.ParameterKey, UsePreviousValue: true });
}
export function validateChangeSet(changeSet) {
 requireThat(changeSet.StackId === target.stack && changeSet.Status === 'CREATE_COMPLETE' && changeSet.ExecutionStatus === 'AVAILABLE', 'Change set is not executable');
 requireThat(!changeSet.RoleARN && (!changeSet.ChangeSetType || changeSet.ChangeSetType === 'UPDATE'), 'Unexpected change set role/type');
 const changes = changeSet.Changes ?? [];
 requireThat(changes.length === 2, 'Expected exactly two function changes');
 const ids = [];
 for (const change of changes) {
  const r = change.ResourceChange;
  requireThat(change.Type === 'Resource' && r && r.Action === 'Modify' && r.ResourceType === 'AWS::Lambda::Function' && r.Replacement === 'False', 'Non-code modification or replacement');
  requireThat(isDeepStrictEqual(r.Scope, ['Properties']) && r.Details?.length > 0, 'Missing property change evidence');
  for (const d of r.Details) {
   requireThat(d.Target?.Attribute === 'Properties' && d.Target.Name === 'Code' && d.Target.RequiresRecreation === 'Never' && d.ChangeSource === 'ParameterReference' && d.CausingEntity === 'CodeKey' && d.Evaluation === 'Static', 'Change is not solely the CodeKey parameter');
  }
  ids.push(r.LogicalResourceId);
 }
 requireThat(isDeepStrictEqual(ids.sort(), ['Api', 'Cleanup']), 'Unexpected logical resources');
}
export function validateUnchanged(before, after) {
 validateStack(after);
 requireThat(isDeepStrictEqual(before.Parameters, after.Parameters) && before.LastUpdatedTime === after.LastUpdatedTime, 'Stack changed concurrently; inspect before retry');
}
