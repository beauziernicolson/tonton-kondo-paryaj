import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));
const results = [];
const test = (name, pass, detail = '') => results.push({ name, pass: Boolean(pass), detail });

const required = [
  'deposit.html', 'withdraw.html',
  'js/plopplop-deposit.js', 'js/plopplop-withdrawal.js', 'js/plopplop-pending-sync.js',
  'supabase/functions/plopplop-create-payment/index.ts',
  'supabase/functions/plopplop-verify-payment/index.ts',
  'supabase/functions/plopplop-create-withdrawal/index.ts',
  'supabase/functions/plopplop-verify-withdrawal/index.ts',
  'supabase/migrations/20260720090000_step10c_plopplop_withdrawals.sql'
];
for (const file of required) test(`file:${file}`, exists(file));

const frontendFiles = ['deposit.html','withdraw.html','js/plopplop-deposit.js','js/plopplop-withdrawal.js','js/plopplop-pending-sync.js'];
const frontend = frontendFiles.map(read).join('\n');
test('frontend:no-client-secret', !/PLOPPLOP_CLIENT_SECRET|client_secret/i.test(frontend));
test('frontend:no-service-role', !/SUPABASE_SERVICE_ROLE_KEY|service_role/i.test(frontend));
test('frontend:no-direct-provider-call', !/plopplop\.solutionip\.app|\/api\/paiement-marchand|\/api\/withdraw\/marchand/i.test(frontend));
test('frontend:no-old-deposit-insert', !/deposit_requests|\.insert\s*\(/i.test(read('deposit.html') + read('js/plopplop-deposit.js')));
test('deposit:min-20', /id="amount-input"[^>]*min="20"/i.test(read('deposit.html')));
test('withdraw:min-max', /id="withdraw-amount-input"[^>]*min="20"[^>]*max="100000"/i.test(read('withdraw.html')));
test('withdraw:methods-restricted', /value="moncash"/.test(read('withdraw.html')) && /value="natcash"/.test(read('withdraw.html')) && !/value="kashpaw"/.test(read('withdraw.html')));

const functions = required.filter((f) => f.endsWith('/index.ts'));
for (const file of functions) {
  const source = read(file);
  test(`${file}:auth-get-user`, /auth\.getUser\s*\(/.test(source));
  test(`${file}:cors-no-star`, !/Access-Control-Allow-Origin["']?\s*:\s*["']\*/.test(source));
  test(`${file}:fixed-provider-origin`, /EXPECTED_PROVIDER_ORIGIN\s*=\s*"https:\/\/plopplop\.solutionip\.app"/.test(source));
  const out = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: file
  });
  const syntaxErrors = (out.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  test(`${file}:typescript-syntax`, syntaxErrors.length === 0, syntaxErrors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join('; '));
}

const withdrawalCreate = read('supabase/functions/plopplop-create-withdrawal/index.ts');
test('withdraw:hmac-order', /\[amountText, method, recipient, providerReference, timestamp\]\.join\("\|"\)/.test(withdrawalCreate));
test('withdraw:new-token-each-operation', /api\/auth\/marchand\/withdrawal-token/.test(withdrawalCreate));
test('withdraw:no-secret-log', !/console\.(log|info|error)\([^\n]*(clientSecret|withdrawalToken|merchantToken)/i.test(withdrawalCreate));
test('withdraw:post-execute-timeout-pending', /if \(executeStarted\)[\s\S]*mark_plopplop_withdrawal_pending/.test(withdrawalCreate));
test('withdraw:pre-execute-failure-refunded', /if \(executeStarted\)[\s\S]*refund_plopplop_withdrawal/.test(withdrawalCreate));
test('withdraw:definitive-provider-failure-refunded', /definitiveNoTransfer[\s\S]*refund_plopplop_withdrawal/.test(withdrawalCreate));
const withdrawalVerify = read('supabase/functions/plopplop-verify-withdrawal/index.ts');
test('withdraw:verify-404-does-not-refund', /status === 404[\s\S]*mark_plopplop_withdrawal_pending/.test(withdrawalVerify) && !/status === 404[\s\S]{0,500}refund_plopplop_withdrawal/.test(withdrawalVerify));

const sql = read('supabase/migrations/20260720090000_step10c_plopplop_withdrawals.sql');
test('sql:rls-enabled', /alter table public\.plopplop_withdrawals enable row level security/i.test(sql));
test('sql:frontend-write-revoked', /revoke all on public\.plopplop_withdrawals from public, anon, authenticated/i.test(sql));
test('sql:service-role-rpcs', /grant execute on function public\.create_or_get_plopplop_withdrawal[\s\S]*to service_role/i.test(sql));
test('sql:unique-request-id', /unique \(request_id\)/i.test(sql));
test('sql:unique-provider-transaction', /unique index[^\n]*provider_transaction|plopplop_withdrawals_provider_transaction_uidx/i.test(sql));
test('sql:refund-idempotence', /refund_reference[\s\S]*unique index|plopplop_withdrawals_refund_reference_uidx/i.test(sql));
test('sql:duplicate-alert-safe', /v_duplicate_transaction[\s\S]*provider_transaction_id_duplicate/i.test(sql));

const failed = results.filter((r) => !r.pass);
const report = { generated_at: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, total: results.length, results };
fs.mkdirSync(path.join(root, 'checks'), { recursive: true });
fs.writeFileSync(path.join(root, 'checks', 'static-security-check.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exit(1);
