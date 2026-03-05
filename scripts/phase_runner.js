#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function main() {
  const args = process.argv.slice(2);
  
  let planPath = null;
  let outDir = null;
  let now = null;
  let receiptPath = null;
  let appendResultPath = null;
  let printNext = false;
  let resume = null;
  let dir = null;
  
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--plan') planPath = args[++i];
    else if (flag === '--out-dir') outDir = args[++i];
    else if (flag === '--now') now = args[++i];
    else if (flag === '--receipt') receiptPath = args[++i];
    else if (flag === '--append-result') appendResultPath = args[++i];
    else if (flag === '--print-next') printNext = true;
    else if (flag === '--resume') resume = args[++i];
    else if (flag === '--dir') dir = args[++i];
  }
  
  if (planPath) {
    if (!outDir) outDir = 'runs/phases';
    if (!now) {
      console.log(JSON.stringify({ ok: false, code: 'INVALID_ARGS', message: 'Missing --now' }, null, 2));
      process.exit(2);
    }
    return createReceipt(planPath, outDir, now);
  }
  if (receiptPath && appendResultPath && now && !printNext) return appendResult(receiptPath, appendResultPath, now);
  if (receiptPath && printNext && !appendResultPath && !now) return printNextInfo(receiptPath);
  if (resume) return doResume(resume, dir || 'runs/phases');
  
  console.log(JSON.stringify({
    ok: false,
    code: 'INVALID_ARGS',
    message: 'Invalid argument combination',
    details: { planPath, outDir, now, receiptPath, appendResultPath, printNext }
  }, null, 2));
  process.exit(2);
}
  
function createReceipt(planPath, outDir, now) {
  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(planPath, 'utf-8'));
  } catch (err) {
    console.log(JSON.stringify({
      ok: false,
      code: 'INVALID_JSON',
      message: 'Failed to parse plan file',
      details: { error: err.message }
    }, null, 2));
    process.exit(2);
  }
  
  if (!plan.run_id || !plan.phase_id || !plan.repo_root || !plan.prompt || typeof plan.phase_index !== 'number') {
    console.log(JSON.stringify({
      ok: false,
      code: 'INVALID_PLAN',
      message: 'Plan missing required fields',
      details: { plan }
    }, null, 2));
    process.exit(2);
  }
  
  fs.mkdirSync(outDir, { recursive: true });
  
  const receipt = {
    ok: true,
    now: now,
    run_id: plan.run_id,
    phase_id: plan.phase_id,
    phase_index: plan.phase_index,
    repo_root: plan.repo_root,
    prompt: plan.prompt,
    status: 'READY_FOR_EXECUTOR',
    next_phase_id: plan.next_phase_id || null,
    paths: {
      plan: planPath,
      receipt: path.join(outDir, `${plan.run_id}.${plan.phase_id}.json`)
    }
  };
  
  const receiptPath = path.join(outDir, `${plan.run_id}.${plan.phase_id}.json`);
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
}

function appendResult(receiptPath, appendResultPath, now) {
  let receipt, execResult;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf-8'));
  } catch (err) {
    console.log(JSON.stringify({
      ok: false,
      code: 'INVALID_JSON',
      message: 'Failed to parse receipt file',
      details: { error: err.message }
    }, null, 2));
    process.exit(2);
  }
  try {
    execResult = JSON.parse(fs.readFileSync(appendResultPath, 'utf-8'));
  } catch (err) {
    console.log(JSON.stringify({
      ok: false,
      code: 'INVALID_JSON',
      message: 'Failed to parse executor result file',
      details: { error: err.message }
    }, null, 2));
    process.exit(2);
  }
  receipt.status = 'EXECUTOR_RESULT_ATTACHED';
  receipt.executor_result = execResult;
  receipt.now = now;
  const tempPath = receiptPath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(receipt, null, 2));
  fs.renameSync(tempPath, receiptPath);
  console.log(JSON.stringify(receipt, null, 2));
}

function printNextInfo(receiptPath) {
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf-8'));
  } catch (err) {
    console.log(JSON.stringify({
      ok: false,
      code: 'INVALID_JSON',
      message: 'Failed to parse receipt file',
      details: { error: err.message }
    }, null, 2));
    process.exit(2);
  }
  console.log(JSON.stringify({
    ok: true,
    run_id: receipt.run_id,
    phase_id: receipt.phase_id,
    next_phase_id: receipt.next_phase_id || null,
    prompt: receipt.prompt
  }, null, 2));
}

function doResume(runId, dir) {
  if (!fs.existsSync(dir)) {
    console.log(JSON.stringify({ ok: false, code: 'NOT_FOUND', message: 'Directory not found', details: { dir } }, null, 2));
    process.exit(2);
  }
  const files = fs.readdirSync(dir).filter(f => f.startsWith(`${runId}.`) && f.endsWith('.json'));
  if (files.length === 0) {
    console.log(JSON.stringify({ ok: false, code: 'NOT_FOUND', message: 'No receipts found', details: { run_id: runId } }, null, 2));
    process.exit(2);
  }
  let selected = null, maxIdx = -1;
  for (const f of files) {
    let r;
    try { r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')); } catch (e) { continue; }
    if (typeof r.phase_index !== 'number') continue;
    if (r.phase_index === maxIdx) {
      console.log(JSON.stringify({ ok: false, code: 'INVALID_STATE', message: 'Duplicate phase_index', details: { phase_index: maxIdx } }, null, 2));
      process.exit(2);
    }
    if (r.phase_index > maxIdx) { maxIdx = r.phase_index; selected = r; }
  }
  if (!selected) {
    console.log(JSON.stringify({ ok: false, code: 'NOT_FOUND', message: 'No valid receipts', details: { run_id: runId } }, null, 2));
    process.exit(2);
  }
  console.log(JSON.stringify({ ok: true, run_id: selected.run_id, current_phase_id: selected.phase_id, current_phase_index: selected.phase_index, next_phase_id: selected.next_phase_id || null, prompt: selected.prompt }, null, 2));
}

main();
