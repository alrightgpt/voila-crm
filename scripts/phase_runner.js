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
  
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--plan') planPath = args[++i];
    else if (flag === '--out-dir') outDir = args[++i];
    else if (flag === '--now') now = args[++i];
    else if (flag === '--receipt') receiptPath = args[++i];
    else if (flag === '--append-result') appendResultPath = args[++i];
    else if (flag === '--print-next') printNext = true;
  }
  
  if (planPath && outDir && now && !receiptPath) return createReceipt(planPath, outDir, now);
  if (receiptPath && appendResultPath && now && !printNext) return appendResult(receiptPath, appendResultPath, now);
  if (receiptPath && printNext && !appendResultPath && !now) return printNextInfo(receiptPath);
  
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
  
  if (!plan.run_id || !plan.phase_id || !plan.repo_root || !plan.prompt) {
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

main();
