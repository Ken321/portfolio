import { createHash } from 'node:crypto';
// Pure local parser: no AWS client, subprocess, credentials, or network calls.
export function summarizeAwsFailure({ stderr = '', status = null, operation = 'unknown' }) {
 const raw = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr);
 const clean = raw.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r\n?/g, '\n');
 let code, reason, requestId;
 try {
  const j = JSON.parse(clean);
  code = j.Error?.Code ?? j.error?.code ?? j.Code ?? j.code ?? j.__type;
  reason = j.Error?.Message ?? j.error?.message ?? j.Message ?? j.message;
  requestId = j.ResponseMetadata?.RequestId ?? j.RequestId;
 } catch { /* Non-JSON AWS CLI errors are normal. */ }
 const standard = clean.match(/An error occurred\s*\(([^)\r\n]+)\)\s*when calling\s+the\s+(\S+)\s+operation(?:\s*\([^\r\n)]*\))?\s*:\s*([\s\S]*)/i);
 if (standard) { code ??= standard[1]; reason ??= standard[3]; }
 code ??= clean.match(/(?:error[_ -]?code|code)\s*[:=]\s*["']?([A-Za-z][A-Za-z0-9_.:#-]*)/i)?.[1];
 code ??= clean.match(/\b(AccessDeniedException|AccessDenied|UnauthorizedOperation|ExpiredTokenException|ExpiredToken|ValidationError|ChangeSetNotFound|ThrottlingException)\b/)?.[1];
 // Never silently discard unmatched text. Always provide a redacted fallback.
 reason ??= clean.trim() || 'No stderr was returned';
 function redact(value) {
  return String(value)
   .replace(/-----BEGIN [\s\S]*?-----END [^-]+-----/g, '[REDACTED KEY]')
   .replace(/(authorization[\"']?\s*[:=]\s*)Bearer\s+[^\s,;]+/gi, '$1[REDACTED]')
   .replace(/\b(?:Bearer\s+\S+|sk-[A-Za-z0-9_-]+|(?:AKIA|ASIA)[A-Z0-9]{16})/gi, '[REDACTED CREDENTIAL]')
   .replace(/((?:["']?)(?:authorization|password|secret(?:accesskey)?|access_token|refresh_token|session_token|aws_secret_access_key|aws_session_token|api[_-]?key)(?:["']?)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, '$1[REDACTED]')
   .replace(/https?:\/\/[^\s"']+/gi, '[URL]')
   .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
   .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
 }
 const safeCode = typeof code === 'string' && /^[A-Za-z0-9_.:#-]{1,160}$/.test(code) ? code : null;
 return {
  operation, exitCode: status, errorCode: safeCode,
  reason: redact(reason).slice(0, 2000),
  reasonTruncated: redact(reason).length > 2000,
  requestId: typeof requestId === 'string' && /^[A-Za-z0-9-]{1,128}$/.test(requestId) ? requestId : null,
  stderrBytes: Buffer.byteLength(raw), stderrSha256: createHash('sha256').update(raw).digest('hex'),
  classification: safeCode ? 'AWS_ERROR_CODE' : 'UNCLASSIFIED_REDACTED_STDERR',
 };
}
// Invoke only from a catch while its exception still exists. Callers retain the
// original exception in memory; never serialize the exception or raw stderr.
export async function saveFailure(error, operation, path) {
 const summary = summarizeAwsFailure({ stderr: error.stderr ?? '', status: error.status ?? null, operation });
 const { writeFile } = await import('node:fs/promises');
 await writeFile(path, JSON.stringify(summary, null, 2), { mode: 0o600, flag: 'wx' });
 return summary;
}

export function safeChangeSetEvidence(changeSet) {
 const hash = value => createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('hex');
 function sanitize(value, path = []) {
  const key = path.at(-1) || '';
  // Unknown environment variables can contain secrets even without a secret-like name.
  if (/secret|password|token|email|api.?key|authorization/i.test(key) || (path.includes('Variables') && path.length > path.indexOf('Variables') + 1)) return { redacted: true, sha256: hash(value) };
  if (Array.isArray(value)) return value.map((v, i) => sanitize(v, [...path, String(i)]));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,sanitize(v,[...path,k])]));
  if (typeof value === 'string') return summarizeAwsFailure({ stderr: value }).reason;
  return value;
 }
 function context(value) {
  if (value === undefined) return { present: false };
  const result = { present: true, sha256: hash(value) };
  try { return { ...result, value: sanitize(JSON.parse(value)) }; }
  catch { return { ...result, parseable: false }; }
 }
 return {
  ChangeSetId: changeSet.ChangeSetId, StackId: changeSet.StackId,
  ChangeSetName: changeSet.ChangeSetName, Status: changeSet.Status,
  ExecutionStatus: changeSet.ExecutionStatus,
  StatusReason: changeSet.StatusReason ? summarizeAwsFailure({ stderr: changeSet.StatusReason }).reason : null,
  hasMorePages: Boolean(changeSet.NextToken),
  Changes: changeSet.Changes?.map(c => ({ Type: c.Type, ResourceChange: {
   LogicalResourceId: c.ResourceChange?.LogicalResourceId, PhysicalResourceId: c.ResourceChange?.PhysicalResourceId,
   Action: c.ResourceChange?.Action, ResourceType: c.ResourceChange?.ResourceType,
   Replacement: c.ResourceChange?.Replacement, Scope: c.ResourceChange?.Scope,
   Details: c.ResourceChange?.Details?.map(d => {
    const path = d.Target?.Path || d.Target?.Name || '';
    const sensitive = /Environment|secret|password|token|email|api.?key/i.test(path);
    return { ...sanitize(d), Target: { ...sanitize(d.Target),
     ...(d.Target?.BeforeValue === undefined ? {} : { BeforeValue: sensitive ? { redacted: true, sha256: hash(d.Target.BeforeValue) } : sanitize(d.Target.BeforeValue) }),
     ...(d.Target?.AfterValue === undefined ? {} : { AfterValue: sensitive ? { redacted: true, sha256: hash(d.Target.AfterValue) } : sanitize(d.Target.AfterValue) }),
    } };
   }),
   BeforeContext: context(c.ResourceChange?.BeforeContext), AfterContext: context(c.ResourceChange?.AfterContext),
  } })),
 };
}
