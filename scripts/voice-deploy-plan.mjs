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
export function validateChangeSet(changeSet, review) {
 if (review) validateReviewBinding(changeSet, review);
 requireThat(!changeSet.StatusReason && !changeSet.NextToken, 'Incomplete, warning-bearing or paginated change set');
 requireThat(changeSet.StackId === target.stack && changeSet.Status === 'CREATE_COMPLETE' && changeSet.ExecutionStatus === 'AVAILABLE', 'Change set is not executable');
 requireThat(!changeSet.RoleARN && (!changeSet.ChangeSetType || changeSet.ChangeSetType === 'UPDATE'), 'Unexpected change set role/type');
 const changes = changeSet.Changes ?? [];
 requireThat(changes.length === 2, 'Expected exactly two function changes');
 const ids = [];
 for (const change of changes) {
  const r = change.ResourceChange;
  requireThat(change.Type === 'Resource' && r && r.Action === 'Modify' && r.ResourceType === 'AWS::Lambda::Function' && r.Replacement === 'False', 'Non-code modification or replacement');
  requireThat(isDeepStrictEqual(r.Scope, ['Properties']) && r.Details?.length > 0, 'Missing property change evidence');
  const staticDetails = r.Details.filter(d => d.ChangeSource === 'ParameterReference' && d.CausingEntity === 'CodeKey' && d.Evaluation === 'Static');
  requireThat(staticDetails.length === 1, 'Missing or ambiguous static CodeKey evidence');
  requireThat(r.Details.length <= 2, 'Unexpected additional detail');
  for (const d of r.Details) {
   requireThat(d.Target?.Attribute === 'Properties' && d.Target.Name === 'Code' && d.Target.RequiresRecreation === 'Never', 'Change is not solely the CodeKey parameter');
   const staticCode = d === staticDetails[0];
   // AWS documents an identical Dynamic/DirectModification companion for a changed Ref parameter.
   // Admit it only with complete, bound property evidence, never on its own.
   requireThat(staticCode || (review && d.ChangeSource === 'DirectModification' && d.Evaluation === 'Dynamic' && !d.CausingEntity && isDeepStrictEqual(d.Target, staticDetails[0].Target)), 'Unmatched or unreviewed dynamic detail');
   if (review) requireThat(d.Target.Path === '/Properties/Code/S3Key' && d.Target.AttributeChangeType === 'Modify' && d.Target.BeforeValue === review.oldKey && d.Target.AfterValue === review.newKey, 'Unexpected property-level code evidence');
  }
  ids.push(r.LogicalResourceId);
 }
 requireThat(isDeepStrictEqual(ids.sort(), ['Api', 'Cleanup']), 'Unexpected logical resources');
}
function validateReviewBinding(changeSet, review) {
 requireThat(changeSet.ChangeSetId === review.changeSetId && changeSet.ChangeSetName === review.name && review.changeSetId?.startsWith(`arn:aws:cloudformation:${target.region}:${target.account}:changeSet/${review.name}/`), 'Unexpected reviewed change set identity');
 requireThat(/^voice\/[a-f0-9]{64}\.zip$/.test(review.newKey) && review.newKey !== review.oldKey, 'Unexpected reviewed ZIP');
 const params = new Map((changeSet.Parameters ?? []).map(p => [p.ParameterKey,p.ParameterValue]));
 requireThat(params.size === review.parameters.size && changeSet.Parameters.length === params.size && [...review.parameters].every(([k,v]) => params.get(k) === (k === 'CodeKey' ? review.newKey : v)), 'Change set parameters differ from reviewed update');
 validateTemplate(review.template);
 validateCodeContexts(changeSet, review.oldKey, review.newKey);
 for (const {ResourceChange:r} of changeSet.Changes ?? []) {
  const resource=review.template.Resources[r.LogicalResourceId];
  requireThat(resource?.Type === 'AWS::Lambda::Function' && ['Api','Cleanup'].includes(r.LogicalResourceId) && r.PhysicalResourceId === `portfolio-voice-${r.LogicalResourceId === 'Api' ? 'api' : 'cleanup'}`, 'Unexpected physical function');
  for (const field of ['BeforeContext','AfterContext']) {
   const context=JSON.parse(r[field]);
   requireThat(isDeepStrictEqual(Object.keys(context).sort(), ['Properties']) && isDeepStrictEqual(Object.keys(context.Properties).sort(), Object.keys(resource.Properties).sort()), 'Incomplete resource property context');
   requireThat(context.Properties.FunctionName === r.PhysicalResourceId, 'Context function mismatch');
   const env=resource.Properties.Environment?.Variables;
   if(env) requireThat(isDeepStrictEqual(Object.keys(context.Properties.Environment?.Variables ?? {}).sort(),Object.keys(env).sort()), 'Incomplete environment context');
   function resolved(v) {
    if(typeof v === 'string') return !/KNOWN_AFTER_APPLY|\{\{|\$\{/.test(v);
    if(v === null || v === undefined) return false;
    if(Array.isArray(v)) return v.every(resolved);
    if(typeof v === 'object') return !Object.keys(v).some(k => k === 'Ref' || k.startsWith('Fn::') || k === 'redacted') && Object.values(v).every(resolved);
    return true;
   }
   requireThat(resolved(context), 'Unresolved or redacted property context');
  }
 }
}
export function validateUnchanged(before, after) {
 validateStack(after);
 requireThat(isDeepStrictEqual(before.Parameters, after.Parameters) && before.LastUpdatedTime === after.LastUpdatedTime, 'Stack changed concurrently; inspect before retry');
}

export function validateCodeContexts(changeSet, oldKey, newKey) {
 for (const { ResourceChange: r } of changeSet.Changes) {
  requireThat(typeof r.BeforeContext === 'string' && typeof r.AfterContext === 'string', 'Missing before/after context');
  let before,after;
  try { before=JSON.parse(r.BeforeContext);after=JSON.parse(r.AfterContext); }
  catch { throw new Error('Invalid before/after context'); }
  requireThat(before?.Properties?.Code?.S3Key === oldKey && after?.Properties?.Code?.S3Key === newKey, 'Unexpected code key context');
  requireThat(before.Properties.Code.S3Bucket === target.bucket && after.Properties.Code.S3Bucket === target.bucket, 'Unexpected code bucket context');
  const b=structuredClone(before),a=structuredClone(after);
  delete b.Properties.Code.S3Key;delete a.Properties.Code.S3Key;
  requireThat(isDeepStrictEqual(b,a), 'Context changed outside Code.S3Key');
 }
}
